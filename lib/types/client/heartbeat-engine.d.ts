/**
 * HeartbeatEngine — measures model token-output throughput from the DSH mux
 * event stream and maps it onto a living heart rate that drifts between
 * hibernation (20-30 BPM idle), a normal working band (50-160 BPM), and a
 * redline rage sprint (180-200 BPM) under sustained high token throughput.
 * The engine owns no DOM and no React — the widget subscribes to snapshots
 * and per-frame animation info.
 */
export type HeartbeatState = 'idle' | 'thinking' | 'streaming' | 'burst' | 'disconnected';
export interface HeartbeatSnapshot {
    /** Smoothed beats per minute. */
    bpm: number;
    /** Instantaneous target BPM before smoothing. */
    targetBpm: number;
    /** Smoothed token output rate (tok/s). */
    rate: number;
    /** Instant token rate over the sliding window. */
    rateRaw: number;
    /** Approximate output tokens counted since the engine started. */
    tokensTotal: number;
    state: HeartbeatState;
    connected: boolean;
    streaming: boolean;
    /** Redline burst mode active. */
    burst: boolean;
    /** Cardiac phase of the current beat, 0..1. */
    phase: number;
    /** Current beat period in ms. */
    periodMs: number;
    /** Provider of the most recent model request (empty until one is seen). */
    provider: string;
    /** Model of the most recent model request. */
    model: string;
}
export interface FrameInfo {
    phase: number;
    bpm: number;
    periodMs: number;
    /** 0..1 systolic thump intensity (peaks at the R wave). */
    pulse: number;
    burst: boolean;
}
type MetricListener = (s: HeartbeatSnapshot) => void;
type FrameListener = (f: FrameInfo) => void;
/** Heartbeat engine. One per plugin instance; lifecycle owned by apply(). */
export declare class HeartbeatEngine {
    private windowTimestamps;
    private tokensTotal;
    private rate;
    private rateRaw;
    private bpm;
    private targetBpm;
    private burst;
    private streaming;
    private connected;
    private anyRunning;
    private provider;
    private model;
    private phase;
    private lastFrameAt;
    private lastTokenAt;
    private lastRateAt;
    private raf;
    private metricTimer;
    private metricListeners;
    private frameListeners;
    private disposed;
    /** Called by the widget with the "any session running" fact. */
    setAnyRunning(v: boolean): void;
    /** Push one decoded mux frame into the engine. */
    handleFrame(frame: import('@deepseek-ai/dsh-client-connection/client').MuxFrame): void;
    /** Called when the transport is known to be down (reconnect/backoff). */
    markDisconnected(): void;
    /** Re-publish after a host connection reset so the UI converges fast. */
    connectionReset(): void;
    /** Start the measurement + animation loops. Call once. */
    start(): void;
    private advance;
    private publishMetrics;
    private frameInfo;
    private classifyState;
    getSnapshot(): HeartbeatSnapshot;
    subscribeMetric(l: MetricListener): () => void;
    subscribeFrame(l: FrameListener): () => void;
    dispose(): void;
}
/** Reusable one-cycle ECG sample table. */
export declare const ECG_CYCLE: Float32Array<ArrayBuffer>;
export declare const ECG_SAMPLES = 260;
export {};
