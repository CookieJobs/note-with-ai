import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config, discoveryCnyCap, discoveryPrice } from '../config';
import NoteDiscoveryEnvironment, { type NoteDiscoveryBilling } from '../models/NoteDiscoveryEnvironment';
import { ErrorHandler } from '../utils/errorHandler';

const settingId = 'note-discovery';
const writeConcern = { w: 'majority' as const, j: true };
const billingInput = z.object({
  model: z.string(),
  embeddingProvider: z.string(),
  embeddingModel: z.string(),
  inputPrice: discoveryPrice,
  outputPrice: discoveryPrice,
  embeddingPrice: discoveryPrice,
  userDaily: discoveryCnyCap,
  globalDaily: discoveryCnyCap,
  reservation: discoveryCnyCap,
});

const deployedModels = () => ({
  model: config.NOTE_DISCOVERY_MODEL,
  embeddingProvider: config.EMBEDDING_PROVIDER,
  embeddingModel: config.EMBEDDING_MODEL,
});

function legacyBilling(): Partial<NoteDiscoveryBilling> {
  return {
    model: config.NOTE_DISCOVERY_PRICED_MODEL,
    embeddingProvider: config.NOTE_DISCOVERY_PRICED_EMBEDDING_PROVIDER || undefined,
    embeddingModel: config.NOTE_DISCOVERY_PRICED_EMBEDDING_MODEL,
    inputPrice: config.NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION,
    outputPrice: config.NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION,
    embeddingPrice: config.NOTE_DISCOVERY_EMBEDDING_CNY_PER_MILLION,
    userCapMicros: config.NOTE_DISCOVERY_USER_DAILY_CNY_MICROS,
    globalCapMicros: config.NOTE_DISCOVERY_GLOBAL_DAILY_CNY_MICROS,
    attemptCapMicros: config.NOTE_DISCOVERY_RUN_RESERVATION_CNY_MICROS,
  };
}

export async function getNoteDiscoveryRuntime() {
  const setting = await NoteDiscoveryEnvironment.findById(settingId).lean();
  const models = deployedModels();
  const billing = setting?.billing;
  const enabled = setting?.enabled ?? config.NOTE_DISCOVERY_ENABLED;
  if (!billing) {
    const configured = config.NOTE_DISCOVERY_CONFIGURED;
    return {
      enabled, configured,
      configurationIssues: configured ? [] : config.NOTE_DISCOVERY_CONFIGURATION_ISSUES,
      runnable: setting?.enabled === undefined ? config.NOTE_DISCOVERY_RUNNABLE : enabled && configured,
      billing: legacyBilling(),
      billingRevision: undefined,
    };
  }
  const modelsMatch = billing.model === models.model && billing.embeddingProvider === models.embeddingProvider
    && billing.embeddingModel === models.embeddingModel;
  const configurationIssues = modelsMatch ? [] : [{ key: 'billingModels', reason: 'mismatch' as const }];
  return { enabled, configured: modelsMatch, runnable: enabled && modelsMatch, configurationIssues, billing, billingRevision: setting.billingRevision };
}

export async function getNoteDiscoveryEnvironment() {
  const { enabled, configured, runnable, configurationIssues } = await getNoteDiscoveryRuntime();
  return { enabled, configured, runnable, configurationIssues };
}

export async function isNoteDiscoveryRunnable() {
  if (NoteDiscoveryEnvironment.db.readyState !== 1) return false;
  return (await getNoteDiscoveryRuntime()).runnable;
}

export async function getNoteDiscoveryBillingForm() {
  const { billing, enabled } = await getNoteDiscoveryRuntime();
  const price = (value?: number) => value === undefined ? '' : value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 12 });
  const cap = (value?: number) => value === undefined ? '' : String(value / 1_000_000);
  const models = deployedModels();
  const generationMatches = billing.model === models.model;
  const embeddingMatches = billing.embeddingProvider === models.embeddingProvider && billing.embeddingModel === models.embeddingModel;
  return {
    ...models, enabled,
    values: {
      inputPrice: generationMatches ? price(billing.inputPrice) : '',
      outputPrice: generationMatches ? price(billing.outputPrice) : '',
      embeddingPrice: embeddingMatches ? price(billing.embeddingPrice) : '',
      userDaily: cap(billing.userCapMicros),
      globalDaily: cap(billing.globalCapMicros),
      reservation: cap(billing.attemptCapMicros),
    },
  };
}

export async function saveNoteDiscoveryBilling(input: unknown) {
  const parsed = billingInput.safeParse(input);
  if (!parsed.success) throw ErrorHandler.createValidationError('请填写有效的人民币单价和预算');
  const { model, embeddingProvider, embeddingModel, inputPrice, outputPrice, embeddingPrice, userDaily, globalDaily, reservation } = parsed.data;
  const models = deployedModels();
  if (model !== models.model || embeddingProvider !== models.embeddingProvider || embeddingModel !== models.embeddingModel) {
    throw ErrorHandler.createValidationError('部署中的模型已变化，请重新打开表单后填写单价');
  }
  if (inputPrice === undefined || outputPrice === undefined || embeddingPrice === undefined
    || userDaily === undefined || globalDaily === undefined || reservation === undefined) {
    throw ErrorHandler.createValidationError('请填写全部单价和预算');
  }
  if ([inputPrice, outputPrice, embeddingPrice].some((value) => value > Number.MAX_SAFE_INTEGER)) {
    throw ErrorHandler.createValidationError('单价超出可计费范围');
  }
  if (reservation > userDaily || userDaily > globalDaily) {
    throw ErrorHandler.createValidationError('单次预留上限须小于或等于每用户每日上限，每用户每日上限须小于或等于全局每日上限');
  }
  if ((await getNoteDiscoveryRuntime()).enabled) throw ErrorHandler.createValidationError('请先关闭环境总开关，再修改计费与预算');
  const billing: NoteDiscoveryBilling = { ...models, inputPrice, outputPrice, embeddingPrice,
    userCapMicros: userDaily, globalCapMicros: globalDaily, attemptCapMicros: reservation };
  try {
    await NoteDiscoveryEnvironment.updateOne({ _id: settingId, enabled: { $ne: true } }, {
      $set: { billing, billingRevision: randomUUID(), enabled: false },
    }, { upsert: true, writeConcern });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    throw ErrorHandler.createValidationError('配置状态已变化，请刷新页面后重试');
  }
  return getNoteDiscoveryEnvironment();
}

export async function setNoteDiscoveryEnvironment(enabled: boolean) {
  if (enabled && !(await getNoteDiscoveryRuntime()).configured) {
    throw ErrorHandler.createValidationError('请先配置笔记发现的计费与预算');
  }
  await NoteDiscoveryEnvironment.updateOne({ _id: settingId }, { $set: { enabled } }, { upsert: true, writeConcern });
  return getNoteDiscoveryEnvironment();
}
