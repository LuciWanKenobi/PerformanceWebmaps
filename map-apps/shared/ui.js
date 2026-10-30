export function setStatus(message, isError = false) {
  const status = document.querySelector('#status');
  status.textContent = message;
  status.dataset.error = String(isError);
}

export function enableControls(reset) {
  const resetButton = document.querySelector('#reset');
  resetButton.disabled = false;
  resetButton.addEventListener('click', reset);
}

export const READY_MESSAGE = 'Map ready. Select a weather overlay or configure a benchmark.';
