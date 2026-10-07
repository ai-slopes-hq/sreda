// Messages from the UI to the engine in the worklet. For now only the test tone; Task 5 brings the real set.
export type ToEngine = { t: 'tone'; hz: number };
