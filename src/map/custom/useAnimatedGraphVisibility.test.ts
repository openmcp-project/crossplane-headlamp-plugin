import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnimatedGraphVisibility } from './useAnimatedGraphVisibility';

const fadeDuration = 150;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function advanceFrames() {
  act(() => {
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  });
}

describe('animated graph visibility', () => {
  it('keeps exiting nodes mounted until the fade finishes', () => {
    const { result, rerender } = renderHook(
      hiddenIds => useAnimatedGraphVisibility(hiddenIds, false, fadeDuration),
      { initialProps: new Set<string>() }
    );
    rerender(new Set(['child']));
    expect(result.current.hiddenIds.has('child')).toBe(false);
    expect(result.current.transparentIds.has('child')).toBe(true);
    advanceFrames();
    act(() => vi.advanceTimersByTime(fadeDuration - 1));
    expect(result.current.hiddenIds.has('child')).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.hiddenIds.has('child')).toBe(true);
  });

  it('keeps the original fade deadline when refreshed targets contain the same IDs', () => {
    const { result, rerender } = renderHook(
      hiddenIds => useAnimatedGraphVisibility(hiddenIds, false, fadeDuration),
      { initialProps: new Set<string>() }
    );
    rerender(new Set(['first', 'second']));
    advanceFrames();
    act(() => vi.advanceTimersByTime(fadeDuration / 2));

    rerender(new Set(['second', 'first']));
    act(() => vi.advanceTimersByTime(fadeDuration / 2));

    expect(result.current.hiddenIds).toEqual(new Set(['first', 'second']));
  });

  it('applies a changed target even when its number of hidden IDs stays the same', () => {
    const { result, rerender } = renderHook(
      hiddenIds => useAnimatedGraphVisibility(hiddenIds, false, fadeDuration),
      { initialProps: new Set(['first']) }
    );
    advanceFrames();
    act(() => vi.advanceTimersByTime(fadeDuration));

    rerender(new Set(['second']));
    advanceFrames();
    act(() => vi.advanceTimersByTime(fadeDuration));

    expect(result.current.hiddenIds).toEqual(new Set(['second']));
    expect(result.current.transparentIds).toEqual(new Set(['second']));
  });

  it('remounts entering nodes at zero opacity before fading them in', () => {
    const { result, rerender } = renderHook(
      hiddenIds => useAnimatedGraphVisibility(hiddenIds, false, fadeDuration),
      { initialProps: new Set(['child']) }
    );
    advanceFrames();
    act(() => vi.advanceTimersByTime(fadeDuration));
    expect(result.current.hiddenIds.has('child')).toBe(true);

    rerender(new Set());
    expect(result.current.hiddenIds.has('child')).toBe(false);
    expect(result.current.transparentIds.has('child')).toBe(true);
    act(() => vi.advanceTimersToNextFrame());
    expect(result.current.transparentIds.has('child')).toBe(true);
    act(() => vi.advanceTimersToNextFrame());
    expect(result.current.transparentIds.has('child')).toBe(false);
  });

  it.each(['before the second frame', 'during the fade'])('cancels an exit reversed %s', timing => {
    const { result, rerender } = renderHook(
      hiddenIds => useAnimatedGraphVisibility(hiddenIds, false, fadeDuration),
      { initialProps: new Set(['child']) }
    );
    if (timing === 'before the second frame') {
      act(() => vi.advanceTimersToNextFrame());
    } else {
      advanceFrames();
      act(() => vi.advanceTimersByTime(fadeDuration / 2));
    }
    rerender(new Set());
    act(() => vi.runAllTimers());
    expect(result.current.hiddenIds.size).toBe(0);
    expect(result.current.transparentIds.size).toBe(0);
  });

  it('applies reduced motion immediately and cancels a pending fade', () => {
    const hiddenIds = new Set(['child']);
    const { result, rerender } = renderHook(
      props => useAnimatedGraphVisibility(props.hiddenIds, props.reduceMotion, fadeDuration),
      { initialProps: { hiddenIds, reduceMotion: false } }
    );
    advanceFrames();
    rerender({ hiddenIds, reduceMotion: true });
    expect(result.current.hiddenIds).toEqual(hiddenIds);
    expect(result.current.transparentIds).toEqual(hiddenIds);
    expect(vi.getTimerCount()).toBe(0);

    rerender({ hiddenIds: new Set(), reduceMotion: true });
    expect(result.current.hiddenIds.size).toBe(0);
    expect(result.current.transparentIds.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['frame', 'timeout'])('cancels its pending %s on unmount', pending => {
    const hiddenIds = new Set(['child']);
    const { unmount } = renderHook(() =>
      useAnimatedGraphVisibility(hiddenIds, false, fadeDuration)
    );
    if (pending === 'timeout') advanceFrames();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
