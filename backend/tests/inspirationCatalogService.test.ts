import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import InspirationItem from '../models/InspirationItem';
import { inspirationCatalogService } from '../services/inspirationCatalogService';

type Row = Record<string, unknown> & { _id: string; userId: string; status: string; createdAt: Date; userState?: string; userStateChangedAt?: Date };
const id = (index: number) => index.toString(16).padStart(24, '0');
const day = (index: number) => new Date(Date.UTC(2026, 8, index + 1));
const row = (index: number, state?: string): Row => ({
  _id: id(index), userId: 'user-1', status: 'completed', createdAt: day(index),
  ...(state ? { userState: state, userStateChangedAt: day(index) } : {}),
  topicLabel: '主题', headline: `灵感 ${index}`, brief: '摘要', whyRelevant: '关联', nextQuestion: '下一步？', sources: [],
});

function installFind(rows: Row[]) {
  mock.method(InspirationItem, 'find', (filter: Record<string, any>) => {
    const query = {
      sort(order: Record<string, number>) {
        assert.deepEqual(order, filter.userState === 'saved' || filter.userState === 'dismissed'
          ? { userStateChangedAt: -1, _id: -1 } : { createdAt: -1, _id: -1 });
        return query;
      },
      limit(count: number) { assert.equal(count, 21); return query; },
      async lean() {
        assert.equal(filter.userId, 'user-1');
        assert.equal(filter.status, 'completed');
        const field = filter.userState === 'saved' || filter.userState === 'dismissed' ? 'userStateChangedAt' : 'createdAt';
        return rows.filter((entry) => {
          if (entry.userId !== filter.userId || entry.status !== 'completed') return false;
          if (filter.userState?.$ne && entry.userState === filter.userState.$ne) return false;
          if (typeof filter.userState === 'string' && entry.userState !== filter.userState) return false;
          if (!filter.$or) return true;
          const clauses = filter.$or as [Record<string, any>, Record<string, any>];
          const cutoff = clauses[0][field]!.$lt as Date;
          const tieId = String(clauses[1]._id!.$lt);
          const orderDate = entry[field] as Date;
          return orderDate.getTime() < cutoff.getTime()
            || (orderDate.getTime() === cutoff.getTime() && entry._id < tieId);
        }).sort((a, b) => (b[field] as Date).getTime() - (a[field] as Date).getTime() || b._id.localeCompare(a._id)).slice(0, 21);
      },
    };
    return query as never;
  });
}

describe('inspiration catalog', () => {
  afterEach(() => mock.restoreAll());

  it('pages through 25 old and new results without duplicating after a newer insertion', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => row(index + 1, index === 1 ? 'saved' : undefined));
    rows.push({ ...row(30, 'dismissed') }, { ...row(31), status: 'draft' }, { ...row(32), userId: 'user-2' });
    installFind(rows);
    const first = await inspirationCatalogService.list('user-1', 'recent', null);
    assert.equal(first.items.length, 20);
    assert.equal(first.items[0].headline, '灵感 25');
    rows.push(row(33));
    const second = await inspirationCatalogService.list('user-1', 'recent', first.nextCursor);
    assert.equal(second.items.length, 5);
    assert.equal(second.items.find((item) => item.headline === '灵感 2')?.userState, 'saved');
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 25);
    assert.equal(second.nextCursor, null);
  });

  it('uses state-change ordering for saved and dismissed views', async () => {
    installFind([row(1, 'saved'), row(2, 'dismissed'), row(3, 'saved')]);
    assert.deepEqual((await inspirationCatalogService.list('user-1', 'saved', null)).items.map((item) => item.headline), ['灵感 3', '灵感 1']);
    assert.deepEqual((await inspirationCatalogService.list('user-1', 'dismissed', null)).items.map((item) => item.headline), ['灵感 2']);
  });

  it('rejects malformed, oversized and wrong-view cursors before querying', async () => {
    await assert.rejects(inspirationCatalogService.list('user-1', 'recent', 'bad cursor'), (error: any) => error.statusCode === 400);
    await assert.rejects(inspirationCatalogService.list('user-1', 'recent', 'x'.repeat(2000)), (error: any) => error.statusCode === 400);
    const wrong = Buffer.from(JSON.stringify({ v: 1, view: 'saved', at: day(1).toISOString(), id: id(1) })).toString('base64url');
    await assert.rejects(inspirationCatalogService.list('user-1', 'recent', wrong), (error: any) => error.statusCode === 400);
  });

  it('does not reveal a result owned by another user or an incomplete draft', async () => {
    const filters: unknown[] = [];
    mock.method(InspirationItem, 'findOne', (filter: unknown) => {
      filters.push(filter);
      return { lean: async () => null } as never;
    });
    await assert.rejects(inspirationCatalogService.detail('user-1', id(9)), (error: any) => error.statusCode === 404);
    assert.deepEqual(filters, [{ _id: id(9), userId: 'user-1', status: 'completed' }]);
  });
});
