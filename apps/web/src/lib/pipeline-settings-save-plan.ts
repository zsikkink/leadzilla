export interface PipelineSettingsSaveTarget {
  key: string;
  value: unknown;
  label: string;
}

interface BuildPipelineSettingsSavePlanOptions {
  currentValues: Record<string, unknown>;
  nextValues: Record<string, unknown>;
  labels: Record<string, string>;
}

const AUTO_APPROVE_SCORE_MIN_KEY = 'auto_approve_score_min';
const AUTO_APPROVE_SCORE_MAX_KEY = 'auto_approve_score_max';
type AutoApproveScoreKey =
  | typeof AUTO_APPROVE_SCORE_MIN_KEY
  | typeof AUTO_APPROVE_SCORE_MAX_KEY;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => areValuesEqual(entry, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => key in right && areValuesEqual(left[key], right[key]))
    );
  }

  return false;
}

function getAutoApproveScoreSaveOrder(
  currentValues: Record<string, unknown>,
  nextValues: Record<string, unknown>,
): [AutoApproveScoreKey, AutoApproveScoreKey] {
  const currentMin = Number(currentValues[AUTO_APPROVE_SCORE_MIN_KEY]);
  const currentMax = Number(currentValues[AUTO_APPROVE_SCORE_MAX_KEY]);
  const nextMin = Number(nextValues[AUTO_APPROVE_SCORE_MIN_KEY]);
  const nextMax = Number(nextValues[AUTO_APPROVE_SCORE_MAX_KEY]);

  if (Number.isFinite(currentMax) && Number.isFinite(nextMin) && nextMin > currentMax) {
    return [AUTO_APPROVE_SCORE_MAX_KEY, AUTO_APPROVE_SCORE_MIN_KEY];
  }

  if (Number.isFinite(currentMin) && Number.isFinite(nextMax) && nextMax < currentMin) {
    return [AUTO_APPROVE_SCORE_MIN_KEY, AUTO_APPROVE_SCORE_MAX_KEY];
  }

  return [AUTO_APPROVE_SCORE_MIN_KEY, AUTO_APPROVE_SCORE_MAX_KEY];
}

export function buildPipelineSettingsSavePlan(
  options: BuildPipelineSettingsSavePlanOptions,
): PipelineSettingsSaveTarget[] {
  const changedKeys = Object.keys(options.nextValues).filter(
    (key) => !areValuesEqual(options.currentValues[key], options.nextValues[key]),
  );

  const hasChangedMin = changedKeys.includes(AUTO_APPROVE_SCORE_MIN_KEY);
  const hasChangedMax = changedKeys.includes(AUTO_APPROVE_SCORE_MAX_KEY);

  let orderedKeys = changedKeys;
  if (hasChangedMin && hasChangedMax) {
    const reorderedAutoApproveKeys = getAutoApproveScoreSaveOrder(
      options.currentValues,
      options.nextValues,
    );
    const firstAutoApproveIndex = changedKeys.findIndex(
      (key) =>
        key === AUTO_APPROVE_SCORE_MIN_KEY || key === AUTO_APPROVE_SCORE_MAX_KEY,
    );
    const nonAutoApproveKeys = changedKeys.filter(
      (key) =>
        key !== AUTO_APPROVE_SCORE_MIN_KEY && key !== AUTO_APPROVE_SCORE_MAX_KEY,
    );

    orderedKeys = [
      ...nonAutoApproveKeys.slice(0, firstAutoApproveIndex),
      ...reorderedAutoApproveKeys,
      ...nonAutoApproveKeys.slice(firstAutoApproveIndex),
    ];
  }

  return orderedKeys.map((key) => ({
    key,
    value: options.nextValues[key],
    label: options.labels[key] ?? key,
  }));
}
