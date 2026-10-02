import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateProfileSchema } from '../schemas/authSchemas';
import { UserValidator } from '../utils/userValidation';

describe('profile avatar contract', () => {
  it('允许未修改头像的用户名更新', () => {
    const result = updateProfileSchema.safeParse({ body: { username: '新用户名' } });

    assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.data.body, { username: '新用户名' });
  });

  it('仅接受稳定预设键作为头像写入值', () => {
    for (const avatar of ['preset:initials', ...Array.from({ length: 8 }, (_, index) => `preset:${String(index + 1).padStart(2, '0')}`)]) {
      assert.equal(updateProfileSchema.safeParse({ body: { avatar } }).success, true, avatar);
    }
    for (const avatar of ['https://legacy.example/avatar.png', 'preset:09', 'unknown']) {
      assert.equal(updateProfileSchema.safeParse({ body: { avatar } }).success, false, avatar);
    }
  });

  it('读取旧 URL 和未知字符串时按原值返回', () => {
    for (const avatar of ['https://legacy.example/old.png', 'legacy:unrecognized-avatar']) {
      const response = UserValidator.formatUserResponse({
        _id: 'user-1',
        username: '测试用户',
        email: 'test@example.com',
        avatar,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastLogin: null,
      });

      assert.equal(response.avatar, avatar);
    }
  });
});
