const tools = [
  {
    name: 'screenshot',
    description:
      'See the current disposable test window. Returns a PNG. Coordinates are pixels from its top-left corner. No other windows are captured.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'click',
    description:
      'Left-click a pixel coordinate in the disposable test window. Inspect a screenshot to locate the target.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 899 },
        y: { type: 'integer', minimum: 0, maximum: 599 },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'type',
    description:
      'Type text into the currently focused control in the disposable test window. Click the input first. This does not choose a control or submit the form.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, maxLength: 128 } },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

function validateAction(name, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Tool arguments must be an object.');
  const keys = Object.keys(input).sort().join(',');
  if (name === 'screenshot' && keys === '') return {};
  if (
    name === 'click' &&
    keys === 'x,y' &&
    Number.isInteger(input.x) &&
    Number.isInteger(input.y) &&
    input.x >= 0 &&
    input.x < 900 &&
    input.y >= 0 &&
    input.y < 600
  )
    return { x: input.x, y: input.y };
  if (
    name === 'type' &&
    keys === 'text' &&
    typeof input.text === 'string' &&
    input.text.length > 0 &&
    input.text.length <= 128 &&
    !/[\x00-\x1f\x7f]/.test(input.text)
  )
    return { text: input.text };
  throw new Error(
    'Unknown tool or invalid arguments. Only screenshot, bounded click, and plain text typing are available.',
  );
}

function handler(invoke) {
  return async (message) => {
    if (message.id === undefined) return;
    const reply = { jsonrpc: '2.0', id: message.id };
    switch (message.method) {
      case 'initialize':
        return {
          ...reply,
          result: {
            protocolVersion: message.params?.protocolVersion || '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'workbench-desktop-probe', version: '1.0.0' },
          },
        };
      case 'ping':
        return { ...reply, result: {} };
      case 'tools/list':
        return { ...reply, result: { tools } };
      case 'tools/call':
        try {
          const name = message.params?.name;
          return {
            ...reply,
            result: await invoke(name, validateAction(name, message.params?.arguments)),
          };
        } catch {
          return {
            ...reply,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'Probe tool failed or rejected its arguments. The test may have ended or exhausted its action budget.',
                },
              ],
            },
          };
        }
      default:
        return {
          ...reply,
          error: { code: -32601, message: 'Method not available in this probe.' },
        };
    }
  };
}
function scoreTrial(trial) {
  const screenshots = trial.actions.filter((a) => a.name === 'screenshot');
  const typeIndex = trial.actions.findIndex((a) => a.name === 'type');
  const verifyIndex = trial.actions.findIndex((a) => a.name === 'click' && a.verified === true);
  const finalObserved = screenshots.some((a) => a.verified === true);
  const observedAfterTyping =
    typeIndex >= 0 &&
    verifyIndex > typeIndex &&
    trial.actions.slice(typeIndex + 1, verifyIndex).some((a) => a.name === 'screenshot');
  return {
    passed: trial.evaluation.verified === true && finalObserved && observedAfterTyping,
    finalObserved,
    observedAfterTyping,
    screenshots: screenshots.length,
    actionCount: trial.actions.length,
    shifted: trial.evaluation.shifted,
    finalStatus: trial.evaluation.status,
    wrongClicks: trial.evaluation.events.filter((e) =>
      ['incorrect', 'reset', 'cancel'].includes(e.kind),
    ).length,
  };
}
module.exports = { tools, validateAction, handler, scoreTrial };
