import { useCallback, useEffect, useRef, useState } from "react";

// Each frame reveals ~1/K of the remaining queue.
// K=8 at 60fps drains a 100-char burst in ~330ms — fast enough to feel linear,
// slow enough to look smooth. `max(1, ...)` floor prevents asymptotic stall.
const K = 8;

interface UseSmoothTextOptions {
	skipInitialAnimation?: boolean;
}

export function useSmoothText(
	text: string,
	isStreaming: boolean,
	options?: UseSmoothTextOptions,
): string {
	const [displayed, setDisplayed] = useState(text);

	const textRef = useRef(text);
	const streamingRef = useRef(isStreaming);
	const revealedRef = useRef(text.length);
	const hasHandledInitialSyncRef = useRef(text.length > 0);
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
		const shouldSkipInitialAnimation =
			options?.skipInitialAnimation === true &&
			!hasHandledInitialSyncRef.current &&
			text.length > 0;
		if (shouldSkipInitialAnimation) {
			revealedRef.current = text.length;
			setDisplayed(text);
			hasHandledInitialSyncRef.current = true;
			return;
		}

		// Never animate completed content. This prevents "tail replay" when
		// remounting a chat and receiving a final text update from storage.
		if (!isStreaming) {
			cancelAnimationFrame(rafRef.current);
			runningRef.current = false;
			revealedRef.current = text.length;
			setDisplayed(text);
			if (text.length > 0) {
				hasHandledInitialSyncRef.current = true;
			}
			return;
		}

		// Text replaced or shortened (new conversation) → snap
		if (text.length < revealedRef.current) {
			revealedRef.current = text.length;
			setDisplayed(text);
			return;
		}

		if (text.length > 0) {
			hasHandledInitialSyncRef.current = true;
		}

		ensureRunning();
	}, [text, isStreaming, ensureRunning, options?.skipInitialAnimation]);

	useEffect(() => {
		return () => {
			cancelAnimationFrame(rafRef.current);
			runningRef.current = false;
		};
	}, []);

	return displayed;
}
