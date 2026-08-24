/**
 * Heartbeat client plugin, browser half. Opens a mux event stream to measure
 * model token-output throughput, drives a HeartbeatEngine, and registers the
 * HeartbeatWidget into the sidebar dock directly under the DSH brand row
 * (ui-sidebar's `sidebar.header.dock` slot).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: the stream connection + the layout slot system. */
export declare const inject: string[];
/**
 * Client plugin body: open a mux stream, start the engine, register the
 * heartbeat widget into the shell.overlay floating layer.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
