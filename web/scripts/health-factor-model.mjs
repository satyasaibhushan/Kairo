export function evaluateWalkForward(pairs) {
  const correlation = pearsonCorrelation(pairs.map((pair) => pair.x), pairs.map((pair) => pair.y));
  if (!Number.isFinite(correlation)) return null;

  const initialTrainingSize = Math.max(14, Math.floor(pairs.length * 0.4));
  const modelErrors = [];
  const baselineErrors = [];
  for (let index = initialTrainingSize; index < pairs.length; index += 1) {
    const training = pairs.slice(0, index);
    const model = fitLinearModel(training);
    if (!model) continue;
    const prediction = model.intercept + model.slope * pairs[index].x;
    modelErrors.push(Math.abs(pairs[index].y - prediction));
    baselineErrors.push(Math.abs(pairs[index].y - model.targetMean));
  }
  if (modelErrors.length < 5) return null;

  const modelMeanAbsoluteError = mean(modelErrors);
  const baselineMeanAbsoluteError = mean(baselineErrors);
  if (!(baselineMeanAbsoluteError > 0)) return null;
  const predictiveGain = 1 - (modelMeanAbsoluteError / baselineMeanAbsoluteError);
  const direction = Math.sign(correlation);
  const foldDirections = chronologicalFolds(pairs, 3)
    .map((fold) => Math.sign(pearsonCorrelation(fold.map((pair) => pair.x), fold.map((pair) => pair.y))))
    .filter((foldDirection) => foldDirection !== 0);
  const stability = foldDirections.length === 0
    ? 0
    : foldDirections.filter((foldDirection) => foldDirection === direction).length / foldDirections.length;

  return {
    correlation,
    predictiveGain,
    stability,
    modelMeanAbsoluteError,
    baselineMeanAbsoluteError,
    evaluatedDays: modelErrors.length,
  };
}

export function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function fitLinearModel(pairs) {
  const xMean = mean(pairs.map((pair) => pair.x));
  const targetMean = mean(pairs.map((pair) => pair.y));
  let covariance = 0;
  let xVariance = 0;
  for (const pair of pairs) {
    covariance += (pair.x - xMean) * (pair.y - targetMean);
    xVariance += (pair.x - xMean) ** 2;
  }
  if (!(xVariance > 0)) return null;
  const slope = covariance / xVariance;
  return { slope, intercept: targetMean - slope * xMean, targetMean };
}

function pearsonCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return Number.NaN;
  const xMean = mean(xs);
  const yMean = mean(ys);
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < xs.length; index += 1) {
    covariance += (xs[index] - xMean) * (ys[index] - yMean);
    xVariance += (xs[index] - xMean) ** 2;
    yVariance += (ys[index] - yMean) ** 2;
  }
  if (!(xVariance > 0) || !(yVariance > 0)) return Number.NaN;
  return covariance / Math.sqrt(xVariance * yVariance);
}

function chronologicalFolds(values, count) {
  const folds = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(values.length * index / count);
    const end = Math.floor(values.length * (index + 1) / count);
    if (end - start >= 3) folds.push(values.slice(start, end));
  }
  return folds;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
