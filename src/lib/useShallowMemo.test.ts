import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useShallowMemo } from './useShallowMemo';

describe('useShallowMemo', () => {
  it('keeps the same object identity while the values are unchanged', () => {
    const onClose = () => {};
    const { result, rerender } = renderHook(
      ({ a, b }) => useShallowMemo({ a, b, onClose }),
      { initialProps: { a: 1, b: 'x' } },
    );

    const first = result.current;
    rerender({ a: 1, b: 'x' });

    expect(result.current).toBe(first);
  });

  it('returns a new object when any value changes', () => {
    const { result, rerender } = renderHook(({ a }) => useShallowMemo({ a }), {
      initialProps: { a: 1 },
    });

    const first = result.current;
    rerender({ a: 2 });

    expect(result.current).not.toBe(first);
    expect(result.current.a).toBe(2);
  });

  it('treats a changed function identity as a change', () => {
    const { result, rerender } = renderHook(
      ({ fn }: { fn: () => string }) => useShallowMemo({ fn }),
      { initialProps: { fn: () => 'first' } },
    );

    const first = result.current;
    rerender({ fn: () => 'second' });

    expect(result.current).not.toBe(first);
  });

  it('returns a new object when a key is added or removed', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: Record<string, unknown> }) => useShallowMemo(value),
      { initialProps: { value: { a: 1 } as Record<string, unknown> } },
    );

    const first = result.current;
    rerender({ value: { a: 1, b: 2 } });

    expect(result.current).not.toBe(first);
  });

  it('does not treat NaN as a change', () => {
    const { result, rerender } = renderHook(({ a }) => useShallowMemo({ a }), {
      initialProps: { a: NaN },
    });

    const first = result.current;
    rerender({ a: NaN });

    expect(result.current).toBe(first);
  });
});
