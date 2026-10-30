// Plain records survive worker messages, IndexedDB, JSON and CSV exports.
export function failureDetails(error, depth = 0) {
  return {
    failureType: error?.name || 'Error',
    failureMessage: error?.message ?? String(error),
    failureStack: error?.stack ?? null,
    failureCause: error?.cause == null ? null : depth < 4
      ? failureDetails(error.cause, depth + 1) : { failureMessage: String(error.cause) },
  };
}

export function errorFromDetails(details) {
  const error = new Error(details.failureMessage || 'GRIB2 worker failed.');
  error.name = details.failureType || 'Error';
  if (details.failureStack) error.stack = details.failureStack;
  if (details.failureCause) error.cause = errorFromDetails(details.failureCause);
  return error;
}
