import { useEffect, useState } from 'react';

export function useAnimatedGraphVisibility(
  nextTargetHiddenIds: ReadonlySet<string>,
  reduceMotion: boolean,
  fadeDuration: number
) {
  const [targetHiddenIds, setTargetHiddenIds] = useState(nextTargetHiddenIds);
  // Stabilize before effect cleanup so live updates cannot restart an unchanged fade.
  if (
    targetHiddenIds !== nextTargetHiddenIds &&
    (targetHiddenIds.size !== nextTargetHiddenIds.size ||
      [...targetHiddenIds].some(id => !nextTargetHiddenIds.has(id)))
  ) {
    setTargetHiddenIds(nextTargetHiddenIds);
  }

  const [visibility, setVisibility] = useState<{
    hiddenIds: ReadonlySet<string>;
    transparentIds: ReadonlySet<string>;
  }>(() => ({ hiddenIds: new Set(), transparentIds: new Set() }));

  useEffect(() => {
    if (reduceMotion) {
      setVisibility({ hiddenIds: targetHiddenIds, transparentIds: targetHiddenIds });
      return;
    }

    // React Flow unmounts hidden nodes, so retain exiting nodes until their fade ends.
    setVisibility(current => ({
      hiddenIds: new Set([...current.hiddenIds].filter(id => targetHiddenIds.has(id))),
      transparentIds: new Set([...current.hiddenIds, ...targetHiddenIds]),
    }));

    let timeout: number | undefined;
    // Paint newly mounted nodes at zero opacity before starting their transition.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setVisibility(current => ({ ...current, transparentIds: targetHiddenIds }));
        timeout = window.setTimeout(
          () => setVisibility({ hiddenIds: targetHiddenIds, transparentIds: targetHiddenIds }),
          fadeDuration
        );
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [targetHiddenIds, reduceMotion, fadeDuration]);

  return visibility;
}
