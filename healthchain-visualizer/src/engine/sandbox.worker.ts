/// <reference lib="webworker" />
// Web Worker wrapper around the contract sandbox.
import { execute, inspect, type ExecRequest, type InspectRequest } from './sandbox';

self.onmessage = (e: MessageEvent<{ id: number; req: ExecRequest | InspectRequest }>) => {
  const { id, req } = e.data;
  const result = req.kind === 'execute' ? execute(req) : inspect(req);
  (self as unknown as Worker).postMessage({ id, result });
};
