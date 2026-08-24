window.__ModuleLoader__.load({
	id: "dsh-heartbeat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/types/client/heartbeat-engine.js
		/**
		* HeartbeatEngine — measures model token-output throughput from the DSH mux
		* event stream and maps it onto a living heart rate that drifts between
		* hibernation (20-30 BPM idle), a normal working band (50-160 BPM), and a
		* redline rage sprint (180-200 BPM) under sustained high token throughput.
		* The engine owns no DOM and no React — the widget subscribes to snapshots
		* and per-frame animation info.
		*/
		const HIBERNATE_BASE = 25;
		const THINK_BPM_BASE = 44;
		const NORMAL_BPM_FLOOR = 50;
		const NORMAL_BPM_AMP = 110;
		const BURST_BPM_BASE = 180;
		const BURST_BPM_CEIL = 200;
		const BURST_ENTER = 40;
		const BURST_LEAVE = 30;
		const WINDOW_MS = 3e3;
		const STREAM_HOLD_MS = 1e3;
		const RATE_TAU = 650;
		const METRIC_INTERVAL_MS = 120;
		function clamp(v, mn, mx) {
			return v < mn ? mn : v > mx ? mx : v;
		}
		/** Organic idle/thinking drift: slow sinusoidal wander + tiny noise. */
		function hibernationDrift(base, span, periodMs) {
			return base + Math.sin(Date.now() / periodMs) * span + (Math.random() - .5) * .6;
		}
		/** Heartbeat engine. One per plugin instance; lifecycle owned by apply(). */
		var HeartbeatEngine = class {
			windowTimestamps = [];
			tokensTotal = 0;
			rate = 0;
			rateRaw = 0;
			bpm = HIBERNATE_BASE;
			targetBpm = HIBERNATE_BASE;
			burst = false;
			streaming = false;
			connected = false;
			anyRunning = false;
			provider = "";
			model = "";
			phase = 0;
			lastFrameAt = 0;
			lastTokenAt = -Infinity;
			lastRateAt = 0;
			raf = 0;
			metricTimer = 0;
			metricListeners = /* @__PURE__ */ new Set();
			frameListeners = /* @__PURE__ */ new Set();
			disposed = false;
			/** Called by the widget with the "any session running" fact. */
			setAnyRunning(v) {
				if (this.anyRunning !== v) {
					this.anyRunning = v;
					this.publishMetrics();
				}
			}
			/** Push one decoded mux frame into the engine. */
			handleFrame(frame) {
				if (frame.type !== "stream/error") this.connected = true;
				if (frame.type !== "session/event") return;
				const ev = frame.event;
				const data = ev.data;
				if (ev.type === "assistant/chunk" && data && "chunk" in data && data.chunk) {
					const chunk = data.chunk;
					if (chunk.type === "text-delta" || chunk.type === "reasoning-delta" || chunk.type === "tool-call-delta") {
						const now = performance.now();
						this.windowTimestamps.push(now);
						this.tokensTotal += 1;
						this.lastTokenAt = now;
					}
				} else if (ev.type === "request/header" && data && "header" in data && data.header) {
					const config = data.header.config;
					if (config?.provider) this.provider = config.provider;
					if (config?.model) this.model = config.model;
				}
			}
			/** Called when the transport is known to be down (reconnect/backoff). */
			markDisconnected() {
				if (this.connected || this.streaming) {
					this.connected = false;
					this.streaming = false;
					this.publishMetrics();
				}
			}
			/** Re-publish after a host connection reset so the UI converges fast. */
			connectionReset() {
				this.publishMetrics();
			}
			/** Start the measurement + animation loops. Call once. */
			start() {
				this.lastFrameAt = performance.now();
				const tick = (now) => {
					if (this.disposed) return;
					this.advance(now);
					this.raf = requestAnimationFrame(tick);
				};
				this.raf = requestAnimationFrame(tick);
				this.metricTimer = window.setInterval(() => this.publishMetrics(), METRIC_INTERVAL_MS);
			}
			advance(now) {
				const cutoff = now - WINDOW_MS;
				let i = 0;
				while (i < this.windowTimestamps.length && (this.windowTimestamps[i] ?? Infinity) < cutoff) i++;
				if (i > 0) this.windowTimestamps.splice(0, i);
				const span = Math.min(WINDOW_MS, now - (this.windowTimestamps[0] ?? now));
				this.rateRaw = span > 1 ? this.windowTimestamps.length / (span / 1e3) : 0;
				const dt = this.lastRateAt === 0 ? METRIC_INTERVAL_MS : now - this.lastRateAt;
				if (dt > 0) {
					const alpha = 1 - Math.exp(-dt / RATE_TAU);
					this.rate += alpha * (this.rateRaw - this.rate);
					this.lastRateAt = now;
				}
				this.streaming = now - this.lastTokenAt < STREAM_HOLD_MS;
				let target;
				if (!this.connected) target = this.bpm;
				else if (!this.streaming && !this.anyRunning) {
					target = clamp(hibernationDrift(HIBERNATE_BASE, 3.6, 9e3), 20, 30);
					this.burst = false;
				} else if (this.streaming && this.rate >= BURST_ENTER) {
					target = clamp(BURST_BPM_BASE + (this.rate - BURST_ENTER) / 40 * (BURST_BPM_CEIL - BURST_BPM_BASE), BURST_BPM_BASE, BURST_BPM_CEIL);
					this.burst = true;
				} else {
					if (!this.streaming && this.anyRunning) target = clamp(hibernationDrift(THINK_BPM_BASE, 3, 12e3), 38, 50);
					else target = clamp(NORMAL_BPM_FLOOR + NORMAL_BPM_AMP * (1 - Math.exp(-this.rate / 24)), NORMAL_BPM_FLOOR, 160);
					if (this.burst && this.rate < BURST_LEAVE) this.burst = false;
				}
				const tau = this.streaming ? 800 : this.anyRunning ? 1500 : 2600;
				const alphaB = 1 - Math.exp(-dt / tau);
				this.bpm += alphaB * (target - this.bpm);
				this.targetBpm = target;
				const periodMs = 6e4 / Math.max(15, this.bpm);
				const phaseDt = now - this.lastFrameAt;
				this.lastFrameAt = now;
				this.phase = (this.phase + phaseDt / periodMs) % 1;
				if (!this.burst && this.phase < .012 && Math.random() < .004) this.phase = .27;
			}
			publishMetrics() {
				const snap = this.getSnapshot();
				for (const l of [...this.metricListeners]) try {
					l(snap);
				} catch {}
				for (const l of [...this.frameListeners]) try {
					l(this.frameInfo());
				} catch {}
			}
			frameInfo() {
				let d = Math.abs(this.phase - .295);
				if (d > .5) d = 1 - d;
				const pulse = d < .16 ? (1 - d / .16) ** 2 : 0;
				return {
					phase: this.phase,
					bpm: this.bpm,
					periodMs: 6e4 / Math.max(15, this.bpm),
					pulse: clamp(pulse, 0, 1),
					burst: this.burst
				};
			}
			classifyState() {
				if (!this.connected) return "disconnected";
				if (this.burst) return "burst";
				if (this.streaming) return "streaming";
				if (this.anyRunning) return "thinking";
				return "idle";
			}
			getSnapshot() {
				return {
					bpm: this.bpm,
					targetBpm: this.targetBpm,
					rate: this.rate,
					rateRaw: this.rateRaw,
					tokensTotal: this.tokensTotal,
					state: this.classifyState(),
					connected: this.connected,
					streaming: this.streaming,
					burst: this.burst,
					phase: this.phase,
					periodMs: 6e4 / Math.max(15, this.bpm),
					provider: this.provider,
					model: this.model
				};
			}
			subscribeMetric(l) {
				this.metricListeners.add(l);
				return () => {
					this.metricListeners.delete(l);
				};
			}
			subscribeFrame(l) {
				this.frameListeners.add(l);
				return () => {
					this.frameListeners.delete(l);
				};
			}
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				cancelAnimationFrame(this.raf);
				window.clearInterval(this.metricTimer);
				this.metricListeners.clear();
				this.frameListeners.clear();
			}
		};
		/** Normal-sinus ECG voltage for a phase within one beat cycle. */
		function ecgVoltage(p) {
			const z = (c, w) => Math.exp(-((p - c) ** 2) / (2 * w * w));
			return .055 * z(.115, .018) + .012 + -.09 * z(.235, .01) + 1.06 * z(.275, .02) + -.22 * z(.335, .014) + .3 * z(.52, .035) + .02 * Math.sin(p * 40) * .15 + .008 * (Math.sin(p * 2.7) - .3);
		}
		/** Reusable one-cycle ECG sample table. */
		const ECG_CYCLE = new Float32Array(260);
		for (let i = 0; i < 260; i++) ECG_CYCLE[i] = ecgVoltage(i / 259);
		//#endregion
		//#region \0dsh-css:Heartbeat.module.css.mjs
		const css = ".HQC6Zq_card{box-sizing:border-box;background:var(--dsw-specific-sidebar-fill,#10141cdb);width:100%;color:var(--dsw-alias-label-primary,#e0e0e0);user-select:none;contain:layout;border:1px solid #7f7f7f24;border-radius:12px;padding:8px 9px 6px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Helvetica Neue,sans-serif;transition:border-color .3s,box-shadow .3s;overflow:hidden;box-shadow:0 3px 14px #00000038}.HQC6Zq_card[data-burst]{border-color:#ff5a3280;box-shadow:0 0 20px #ff3c1e59,0 3px 14px #00000040}.HQC6Zq_floating{z-index:2147483645;box-sizing:border-box;backdrop-filter:blur(12px);width:248px;color:var(--dsw-alias-label-primary,#e0e0e0);user-select:none;contain:layout;background:#0e121adb;border:1px solid #7f7f7f29;border-radius:14px;padding:10px 11px 8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Helvetica Neue,sans-serif;transition:border-color .3s,box-shadow .3s;position:fixed;bottom:20px;right:20px;overflow:hidden;box-shadow:0 8px 30px #00000080}.HQC6Zq_floating[data-burst]{border-color:#ff5a3280;box-shadow:0 0 24px #ff3c1e66,0 8px 30px #00000080}.HQC6Zq_topRow{align-items:center;gap:9px;display:flex}.HQC6Zq_heartWrap{flex-shrink:0;justify-content:center;align-items:center;width:38px;height:38px;display:flex;position:relative}.HQC6Zq_glow{opacity:0;will-change:transform, opacity;background:radial-gradient(circle,#ff4664a6 0%,#ff466400 70%);border-radius:50%;width:30px;height:30px;position:absolute}.HQC6Zq_card[data-burst] .HQC6Zq_glow{background:radial-gradient(circle,#ff5a28cc 0%,#ff3c1400 70%)}.HQC6Zq_heartBox{will-change:transform;z-index:1;justify-content:center;align-items:center;width:28px;height:28px;display:flex}.HQC6Zq_heartSvg{filter:drop-shadow(0 0 6px #ff466480);width:26px;height:26px}.HQC6Zq_card[data-burst] .HQC6Zq_heartSvg{filter:drop-shadow(0 0 10px #ff5028cc)}.HQC6Zq_heartPath{fill:#f46;stroke:#f35;stroke-width:.5px}.HQC6Zq_card[data-state=hibernate] .HQC6Zq_heartPath,.HQC6Zq_card[data-state=idle] .HQC6Zq_heartPath{fill:#3a6ea8;stroke:#5b8fd4}.HQC6Zq_card[data-state=thinking] .HQC6Zq_heartPath{fill:#2e7d8f;stroke:#4fa8bd}.HQC6Zq_card[data-state=streaming] .HQC6Zq_heartPath{fill:#2fa86b;stroke:#45c98a}.HQC6Zq_card[data-burst] .HQC6Zq_heartPath{fill:#ff4a26;stroke:#ff7a4d}.HQC6Zq_stats{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.HQC6Zq_bpmRow{font-variant-numeric:tabular-nums;align-items:baseline;gap:5px;display:flex}.HQC6Zq_bpmNumber{letter-spacing:-.5px;font-size:26px;font-weight:800;line-height:1}.HQC6Zq_bpmUnit{color:var(--dsw-alias-label-tertiary,#999);text-transform:uppercase;letter-spacing:.6px;font-size:10px;font-weight:500}.HQC6Zq_burstFlash{margin-left:2px;font-size:12px;animation:.5s steps(2,end) infinite HQC6Zq_burstBlink}@keyframes HQC6Zq_burstBlink{50%{opacity:.15}}.HQC6Zq_rateRow{color:var(--dsw-alias-label-tertiary,#aaa);white-space:nowrap;align-items:center;gap:5px;font-size:11.5px;display:flex;overflow:hidden}.HQC6Zq_rateValue{font-variant-numeric:tabular-nums;font-weight:600}.HQC6Zq_modelLabel{color:var(--dsw-alias-label-tertiary,#777);text-overflow:ellipsis;white-space:nowrap;max-width:52%;margin-left:auto;font-size:10.5px;overflow:hidden}.HQC6Zq_stateBadge{letter-spacing:.3px;white-space:nowrap;border-radius:4px;align-items:center;gap:4px;padding:1px 6px;font-size:10px;font-weight:600;display:inline-flex}.HQC6Zq_stateHibernate{color:#7fb3e8;background:#5082c82e}.HQC6Zq_stateThinking{color:#63c6d8;background:#5abed229}.HQC6Zq_stateStreaming{color:#4ade80;background:#00c8782e}.HQC6Zq_stateBurst{color:#ff8a66;background:#ff462838}.HQC6Zq_stateDisconnected{color:#f87171;background:#ff323226}.HQC6Zq_ecgWrap{border-top:1px solid #7f7f7f1f;border-radius:4px;width:100%;height:46px;margin-top:7px;padding-top:4px;overflow:hidden}.HQC6Zq_ecgCanvas{width:100%;height:100%;image-rendering:crisp-edges;display:block}.HQC6Zq_footRow{color:var(--dsw-alias-label-tertiary,#666);font-variant-numeric:tabular-nums;align-items:center;gap:6px;margin-top:5px;font-size:10.5px;display:flex}.HQC6Zq_footSep{opacity:.5}.HQC6Zq_footRaw{opacity:.75;margin-left:auto}.HQC6Zq_rail{user-select:none;color:var(--dsw-alias-label-primary,#e0e0e0);contain:layout;flex-direction:column;align-items:center;gap:1px;padding:2px 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Helvetica Neue,sans-serif;display:flex}.HQC6Zq_railHeart{color:#f46;text-shadow:0 0 8px #ff46648c;font-size:16px;line-height:1;transition:color .4s;animation:2.4s ease-in-out infinite HQC6Zq_railBeat}.HQC6Zq_rail[data-state=hibernate] .HQC6Zq_railHeart,.HQC6Zq_rail[data-state=idle] .HQC6Zq_railHeart{color:#4a80c0;text-shadow:0 0 8px #508cd280;animation-duration:3.2s}.HQC6Zq_rail[data-state=thinking] .HQC6Zq_railHeart{color:#4fa8bd;text-shadow:0 0 8px #50b4c880}.HQC6Zq_rail[data-state=streaming] .HQC6Zq_railHeart{color:#2fa86b;text-shadow:0 0 8px #32c87880}.HQC6Zq_rail[data-burst] .HQC6Zq_railHeart{color:#ff4a26;text-shadow:0 0 10px #ff5028cc;animation-duration:.4s}.HQC6Zq_railBpm{font-variant-numeric:tabular-nums;letter-spacing:.2px;color:var(--dsw-alias-label-secondary,#c8c8c8);font-size:11px;font-weight:700}@keyframes HQC6Zq_railBeat{0%,to{transform:scale(1)}12%{transform:scale(1.4)}24%{transform:scale(1.15)}38%{transform:scale(1.32)}55%{transform:scale(1)}}";
		const tagId = "dsh-heartbeat/Heartbeat.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-heartbeat";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Heartbeat_module_css_default = {
			"rateValue": "HQC6Zq_rateValue",
			"stateBurst": "HQC6Zq_stateBurst",
			"stateBadge": "HQC6Zq_stateBadge",
			"railBpm": "HQC6Zq_railBpm",
			"bpmNumber": "HQC6Zq_bpmNumber",
			"heartPath": "HQC6Zq_heartPath",
			"ecgWrap": "HQC6Zq_ecgWrap",
			"burstFlash": "HQC6Zq_burstFlash",
			"ecgCanvas": "HQC6Zq_ecgCanvas",
			"stateDisconnected": "HQC6Zq_stateDisconnected",
			"stats": "HQC6Zq_stats",
			"card": "HQC6Zq_card",
			"rateRow": "HQC6Zq_rateRow",
			"stateHibernate": "HQC6Zq_stateHibernate",
			"stateStreaming": "HQC6Zq_stateStreaming",
			"burstBlink": "HQC6Zq_burstBlink",
			"bpmUnit": "HQC6Zq_bpmUnit",
			"topRow": "HQC6Zq_topRow",
			"heartWrap": "HQC6Zq_heartWrap",
			"modelLabel": "HQC6Zq_modelLabel",
			"heartBox": "HQC6Zq_heartBox",
			"stateThinking": "HQC6Zq_stateThinking",
			"glow": "HQC6Zq_glow",
			"railBeat": "HQC6Zq_railBeat",
			"railHeart": "HQC6Zq_railHeart",
			"footRaw": "HQC6Zq_footRaw",
			"rail": "HQC6Zq_rail",
			"bpmRow": "HQC6Zq_bpmRow",
			"floating": "HQC6Zq_floating",
			"heartSvg": "HQC6Zq_heartSvg",
			"footRow": "HQC6Zq_footRow",
			"footSep": "HQC6Zq_footSep"
		};
		//#endregion
		//#region lib/types/client/Heartbeat.js
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
		const DEFAULT_SNAPSHOT = {
			bpm: 25,
			targetBpm: 25,
			rate: 0,
			rateRaw: 0,
			tokensTotal: 0,
			state: "idle",
			connected: false,
			streaming: false,
			burst: false,
			phase: 0,
			periodMs: 2400,
			provider: "",
			model: ""
		};
		const STATE_META = {
			idle: {
				text: "冬眠",
				cls: Heartbeat_module_css_default.stateHibernate,
				hue: 210
			},
			thinking: {
				text: "思考",
				cls: Heartbeat_module_css_default.stateThinking,
				hue: 190
			},
			streaming: {
				text: "输出",
				cls: Heartbeat_module_css_default.stateStreaming,
				hue: 140
			},
			burst: {
				text: "狂暴",
				cls: Heartbeat_module_css_default.stateBurst,
				hue: 8
			},
			disconnected: {
				text: "离线",
				cls: Heartbeat_module_css_default.stateDisconnected,
				hue: 0
			}
		};
		/** Smooth systolic thump profile (mirrors the engine's R-wave phase). */
		function pulseAt(phase, center = .295) {
			let d = Math.abs(phase - center);
			if (d > .5) d = 1 - d;
			return d < .16 ? (1 - d / .16) ** 2 : 0;
		}
		function HeartbeatWidget({ engine, wide = true, floating = false, useSessions }) {
			const [metrics, setMetrics] = (0, react.useState)(DEFAULT_SNAPSHOT);
			const rootRef = (0, react.useRef)(null);
			const canvasRef = (0, react.useRef)(null);
			const heartRef = (0, react.useRef)(null);
			const glowRef = (0, react.useRef)(null);
			const anyRunning = useSessions((s) => s.ids.some((id) => s.byId[id]?.running === true));
			(0, react.useEffect)(() => {
				engine.setAnyRunning(anyRunning);
			}, [engine, anyRunning]);
			(0, react.useEffect)(() => {
				return engine.subscribeMetric((snap) => {
					setMetrics(snap);
				});
			}, [engine]);
			const drawFrame = (0, react.useCallback)((snap) => {
				const canvas = canvasRef.current;
				if (!canvas) return;
				const g = canvas.getContext("2d");
				if (!g) return;
				const dpr = window.devicePixelRatio || 1;
				const rect = canvas.getBoundingClientRect();
				const w = rect.width;
				const h = rect.height;
				if (w <= 0 || h <= 0) return;
				if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
					canvas.width = Math.round(w * dpr);
					canvas.height = Math.round(h * dpr);
				}
				g.setTransform(dpr, 0, 0, dpr, 0, 0);
				g.clearRect(0, 0, w, h);
				const { phase, burst } = snap;
				const hue = STATE_META[snap.state]?.hue ?? 140;
				const trace = burst ? "hsl(12 90% 60%)" : `hsl(${hue} 80% 62%)`;
				const traceGlow = burst ? "rgba(255, 70, 40, 0.55)" : `hsla(${hue} 90% 60% / 0.45)`;
				const baseline = h * .74;
				const scaleY = h * .42;
				const margin = 2;
				const sampleW = w - 2 * margin;
				g.strokeStyle = "rgba(255,255,255,0.04)";
				g.lineWidth = .5;
				const gridX = w / 10;
				const gridY = h / 6;
				for (let x = 0; x < w; x += gridX) {
					g.beginPath();
					g.moveTo(x, 0);
					g.lineTo(x, h);
					g.stroke();
				}
				for (let y = 0; y < h; y += gridY) {
					g.beginPath();
					g.moveTo(0, y);
					g.lineTo(w, y);
					g.stroke();
				}
				g.strokeStyle = "rgba(255,255,255,0.10)";
				g.lineWidth = .75;
				g.beginPath();
				g.moveTo(0, baseline);
				g.lineTo(w, baseline);
				g.stroke();
				g.beginPath();
				g.strokeStyle = trace;
				g.lineWidth = burst ? 2 : 1.5;
				g.lineJoin = "round";
				g.lineCap = "round";
				g.shadowColor = traceGlow;
				g.shadowBlur = burst ? 7 : 3;
				let drawn = 0;
				for (let i = 0; i < 260; i++) {
					const samplePhase = i / 259;
					if (samplePhase > phase) break;
					const v = ECG_CYCLE[i] ?? 0;
					const x = margin + samplePhase * sampleW;
					const y = baseline - v * scaleY;
					if (i === 0) g.moveTo(x, y);
					else g.lineTo(x, y);
					drawn = i;
				}
				g.stroke();
				g.shadowBlur = 0;
				const sweepX = margin + phase * sampleW;
				if (phase < .985) {
					g.strokeStyle = burst ? "rgba(255,90,50,0.5)" : traceGlow;
					g.lineWidth = 1;
					g.beginPath();
					g.moveTo(sweepX, 2);
					g.lineTo(sweepX, h - 2);
					g.stroke();
					const dotY = baseline - (ECG_CYCLE[Math.min(259, drawn)] ?? 0) * scaleY;
					g.fillStyle = burst ? "#ff9a66" : trace;
					g.shadowColor = traceGlow;
					g.shadowBlur = 8;
					g.beginPath();
					g.arc(sweepX, dotY, burst ? 3 : 2.6, 0, Math.PI * 2);
					g.fill();
					g.shadowBlur = 0;
				}
				if (burst) {
					const t = performance.now() / 1e3;
					for (let k = 0; k < 6; k++) {
						const a = k / 6 * Math.PI * 2 + t * 2;
						const r = 8 + (t * 30 + k * 17) % 14;
						const px = sweepX + Math.cos(a) * r;
						const py = baseline - (ECG_CYCLE[Math.min(259, drawn)] ?? 0) * scaleY + Math.sin(a) * r;
						g.fillStyle = `hsla(15 95% 65% / ${.7 - (r - 8) / 18})`;
						g.beginPath();
						g.arc(px, py, 1.4, 0, Math.PI * 2);
						g.fill();
					}
				}
			}, []);
			const rafRef = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				let running = true;
				const loop = () => {
					if (!running) return;
					const snap = engine.getSnapshot();
					drawFrame(snap);
					const heart = heartRef.current;
					if (heart) {
						const p1 = pulseAt(snap.phase, .295);
						const p2 = pulseAt(snap.phase, .4) * .45;
						const intensity = 1 + (snap.burst ? .14 : .09) * p1 + .045 * p2;
						heart.style.transform = `scale(${intensity.toFixed(4)})`;
					}
					const glow = glowRef.current;
					if (glow) {
						const p = pulseAt(snap.phase, .295);
						const strength = snap.burst ? .85 : .35;
						glow.style.opacity = String((p * strength).toFixed(3));
						glow.style.transform = `scale(${(1 + p * (snap.burst ? 1.3 : .9)).toFixed(3)})`;
					}
					rafRef.current = requestAnimationFrame(loop);
				};
				rafRef.current = requestAnimationFrame(loop);
				return () => {
					running = false;
					cancelAnimationFrame(rafRef.current);
				};
			}, [engine, drawFrame]);
			const bpmDisplay = Math.round(metrics.bpm);
			const rateDisplay = metrics.rate.toFixed(1);
			const meta = STATE_META[metrics.state] ?? {
				text: "待机",
				cls: void 0,
				hue: 140
			};
			const modelLabel = metrics.model || (metrics.provider ? metrics.provider : "—");
			const cardBody = (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsxs)("div", {
					className: Heartbeat_module_css_default.topRow,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: Heartbeat_module_css_default.heartWrap,
						children: [(0, react_jsx_runtime.jsx)("div", {
							ref: glowRef,
							className: Heartbeat_module_css_default.glow
						}), (0, react_jsx_runtime.jsx)("div", {
							ref: heartRef,
							className: Heartbeat_module_css_default.heartBox,
							children: (0, react_jsx_runtime.jsx)("svg", {
								className: Heartbeat_module_css_default.heartSvg,
								viewBox: "0 0 24 24",
								xmlns: "http://www.w3.org/2000/svg",
								"aria-hidden": true,
								children: (0, react_jsx_runtime.jsx)("path", {
									className: Heartbeat_module_css_default.heartPath,
									d: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5\n                   2 5.42 4.42 3 7.5 3c1.74 0 3.41 0.81 4.5 2.09\n                   C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5\n                   c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
								})
							})
						})]
					}), (0, react_jsx_runtime.jsxs)("div", {
						className: Heartbeat_module_css_default.stats,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: Heartbeat_module_css_default.bpmRow,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: Heartbeat_module_css_default.bpmNumber,
									children: bpmDisplay
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: Heartbeat_module_css_default.bpmUnit,
									children: "BPM"
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: `${Heartbeat_module_css_default.stateBadge} ${meta.cls}`,
									children: meta.text
								}),
								metrics.burst && (0, react_jsx_runtime.jsx)("span", {
									className: Heartbeat_module_css_default.burstFlash,
									children: "⚡"
								})
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: Heartbeat_module_css_default.rateRow,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: Heartbeat_module_css_default.rateValue,
									children: rateDisplay
								}),
								(0, react_jsx_runtime.jsx)("span", { children: "tok/s" }),
								(0, react_jsx_runtime.jsx)("span", {
									className: Heartbeat_module_css_default.modelLabel,
									title: modelLabel,
									children: modelLabel
								})
							]
						})]
					})]
				}),
				(0, react_jsx_runtime.jsx)("div", {
					className: Heartbeat_module_css_default.ecgWrap,
					children: (0, react_jsx_runtime.jsx)("canvas", {
						ref: canvasRef,
						className: Heartbeat_module_css_default.ecgCanvas
					})
				}),
				(0, react_jsx_runtime.jsxs)("div", {
					className: Heartbeat_module_css_default.footRow,
					children: [
						(0, react_jsx_runtime.jsxs)("span", {
							title: "累计输出 token（约）",
							children: ["∑", metrics.tokensTotal]
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: Heartbeat_module_css_default.footSep,
							children: "·"
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							title: "平滑速率",
							children: [rateDisplay, " tok/s"]
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: Heartbeat_module_css_default.footRaw,
							title: "瞬时速率",
							children: [metrics.rateRaw.toFixed(1), "/s"]
						})
					]
				})
			] });
			if (floating) return (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: Heartbeat_module_css_default.floating,
				"data-state": metrics.state,
				"data-burst": metrics.burst || void 0,
				role: "status",
				"aria-label": `心率 ${bpmDisplay} BPM，${rateDisplay} tok/s，状态 ${meta.text}`,
				children: cardBody
			});
			if (!wide) return (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: Heartbeat_module_css_default.rail,
				"data-state": metrics.state,
				"data-burst": metrics.burst || void 0,
				role: "status",
				"aria-label": `心率 ${bpmDisplay} BPM，状态 ${meta.text}`,
				title: `${meta.text} · ${bpmDisplay} BPM · ${rateDisplay} tok/s`,
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: Heartbeat_module_css_default.railHeart,
					"data-burst": metrics.burst || void 0,
					children: "♥"
				}), (0, react_jsx_runtime.jsx)("span", {
					className: Heartbeat_module_css_default.railBpm,
					children: bpmDisplay
				})]
			});
			return (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: Heartbeat_module_css_default.card,
				"data-state": metrics.state,
				"data-burst": metrics.burst || void 0,
				role: "status",
				"aria-label": `心率 ${bpmDisplay} BPM，${rateDisplay} tok/s，状态 ${meta.text}`,
				children: cardBody
			});
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Required services: the stream connection + the layout slot system. */
		const inject = ["connection", "slots"];
		/**
		* Client plugin body: open a mux stream, start the engine, register the
		* heartbeat widget into the shell.overlay floating layer.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const engine = new HeartbeatEngine();
			let disposed = false;
			let streamAbort = null;
			function startStream() {
				if (disposed) return;
				const connection = ctx.get("connection");
				const ac = new AbortController();
				streamAbort = ac;
				const stream = connection.api.events.mux({}, ac.signal);
				(async () => {
					try {
						for await (const envelope of stream) {
							if (disposed) break;
							engine.handleFrame(envelope.payload);
						}
					} catch {}
					if (!disposed) setTimeout(() => {
						if (!disposed) {
							engine.markDisconnected();
							startStream();
						}
					}, 1500);
				})();
			}
			ctx.on("connection/reset", () => {
				engine.connectionReset();
			});
			engine.start();
			startStream();
			ctx.effect(() => {
				const disposeReg = ctx.slots.spec("sidebar.header.dock") !== void 0 ? ctx.slots.register({
					name: "sidebar.header.dock",
					id: "heartbeat",
					order: 100,
					inject: () => ({ engine })
				}, HeartbeatWidget) : ctx.slots.register({
					name: "shell.overlay",
					id: "heartbeat",
					order: 1e4,
					inject: () => ({
						engine,
						floating: true
					})
				}, HeartbeatWidget);
				return () => {
					disposeReg();
				};
			}, "heartbeat: register widget (dock or overlay fallback)");
			ctx.effect(() => {
				return () => {
					disposed = true;
					streamAbort?.abort();
					engine.dispose();
				};
			}, "heartbeat: cleanup");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
