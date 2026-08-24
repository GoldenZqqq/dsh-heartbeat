/**
 * HeartbeatWidget — a heart-rate monitor docked to the sidebar directly under
 * the DSH brand row (the ui-sidebar `sidebar.header.dock` list slot). The
 * rhythm mirrors DSH model activity — token output speed drives the pulse:
 *
 *   idle / hibernation   20-30 BPM   (nothing running — sleeping heart)
 *   thinking             38-50 BPM   (session running, pre-first-token)
 *   streaming            50-160 BPM  (tokens flowing — scales with tok/s)
 *   burst/rage           180-200 BPM (sustained high throughput — redline)
 *
 * Wide sidebar shows a compact card (pulsing heart, big BPM, state badge,
 * model label, live ECG strip, token stats); the collapsed 56px rail keeps
 * only a small pulsing dot + BPM so the machine stays visibly alive.
 *
 * Sizing is themes-agnostic: it reads only its own box and theme-design
 * tokens available in every surface, so the card hugs the sidebar column.
 */
import React from 'react';
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots';
import { HeartbeatEngine } from './heartbeat-engine.ts';
export interface HeartbeatWidgetProps extends GlobalStandardProps {
    /** The plugin-owned measurement engine (injected by the slot registration). */
    engine: HeartbeatEngine;
    /**
     * Sidebar column state (dock registrations only): false = 56px rail →
     * compact dot. Absent on the floating fallback, which always renders the
     * full card.
     */
    wide?: boolean;
    /**
     * Floating fallback mode (injected): the frame-wide shell.overlay seat on
     * DSH builds whose ui-sidebar does not declare the header dock slot yet.
     * Fixes the card to the bottom-right corner; never draggable or collapsible
     * in either seat.
     */
    floating?: boolean;
}
export declare function HeartbeatWidget({ engine, wide, floating, useSessions }: HeartbeatWidgetProps): React.JSX.Element;
