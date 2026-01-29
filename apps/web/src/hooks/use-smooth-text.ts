import { useCallback, useEffect, useRef, useState } from "react";

// Each frame reveals ~1/K of the remaining queue.
// K=8 at 60fps drains a 100-char burst in ~330ms — fast enough to feel linear,
// slow enough to look smooth. `max(1, ...)` floor prevents asymptotic stall.
const K = 8;

export function useSmoothText(text: string, isStreaming: boolean): string {
	const [displayed, setDisplayed] = useState(text);

	const textRef = useRef(text);
	const streamingRef = useRef(isStreaming);
	const revealedRef = useRef(text.length);
	const rafRef = useRef(0);
	const runningRef = useRef(false);

	textRef.current = text;
	streamingRef.current = isStreaming;

	// Single persistent rAF loop — reads only refs, never captures stale props
	const ensureRunning = useCallback(() => {
		if (runningRef.current) return;
		runningRef.current = true;

		const tick = () => {
			const fullText = textRef.current;
			const queue = fullText.length - revealedRef.current;

			if (queue > 0) {
				const advance = Math.max(1, Math.floor(queue / K));
				revealedRef.current = Math.min(
					revealedRef.current + advance,
					fullText.length,
				);
				setDisplayed(fullText.slice(0, revealedRef.current));
			}

			// Keep ticking if: still streaming (more text may arrive) OR queue remains
			if (streamingRef.current || fullText.length > revealedRef.current) {
				rafRef.current = requestAnimationFrame(tick);
			} else {
				runningRef.current = false;
			}
		};

		rafRef.current = requestAnimationFrame(tick);
	}, []);

	useEffect(() => {
		// Text replaced or shortened (new conversation) → snap
		if (text.length < revealedRef.current) {
			revealedRef.current = text.length;
			setDisplayed(text);
			return;
		}

		const queue = text.length - revealedRef.current;
		if (queue > 0 || isStreaming) {
			ensureRunning();
		}
	}, [text, isStreaming, ensureRunning]);

	useEffect(() => {
		return () => {
			cancelAnimationFrame(rafRef.current);
			runningRef.current = false;
		};
	}, []);

	return displayed;
}
