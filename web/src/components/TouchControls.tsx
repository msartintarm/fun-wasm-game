import { RelativeTurn } from "@/lib/relativeTurn";
import { TouchControlsMode, TouchControlsScheme } from "@/lib/touchControlsSettings";
import styles from "./TouchControls.module.css";

interface TouchControlsProps {
  mode: TouchControlsMode;
  scheme: TouchControlsScheme;
  // Dpad scheme only — 0-3 = Up/Down/Left/Right, matches KEY_TO_DIR.
  onDirection: (dir: number) => void;
  // Relative scheme only.
  onRelativeTurn: (turn: RelativeTurn) => void;
}

export default function TouchControls({ mode, scheme, onDirection, onRelativeTurn }: TouchControlsProps) {
  if (mode === TouchControlsMode.Hide) return null;
  const forceShow = mode === TouchControlsMode.Show;

  if (scheme === TouchControlsScheme.Relative) {
    const rowClassName = forceShow ? `${styles.row} ${styles.forceShow}` : styles.row;
    return (
      <div className={rowClassName} aria-label="Touch controls">
        <button
          type="button"
          onClick={() => onRelativeTurn(RelativeTurn.Left)}
          className={styles.dpadButton}
          aria-label="Turn left"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={() => onRelativeTurn(RelativeTurn.UTurnLeft)}
          className={styles.dpadButton}
          aria-label="U-turn to the left"
        >
          ↺
        </button>
        <button
          type="button"
          onClick={() => onRelativeTurn(RelativeTurn.UTurnRight)}
          className={styles.dpadButton}
          aria-label="U-turn to the right"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={() => onRelativeTurn(RelativeTurn.Right)}
          className={styles.dpadButton}
          aria-label="Turn right"
        >
          ↷
        </button>
      </div>
    );
  }

  const dpadClassName = forceShow ? `${styles.dpad} ${styles.forceShow}` : styles.dpad;
  return (
    <div className={dpadClassName} aria-label="Touch controls">
      <button
        type="button"
        onClick={() => onDirection(0)}
        className={`${styles.dpadButton} ${styles.up}`}
        aria-label="Move up"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onDirection(2)}
        className={`${styles.dpadButton} ${styles.left}`}
        aria-label="Move left"
      >
        ←
      </button>
      <button
        type="button"
        onClick={() => onDirection(3)}
        className={`${styles.dpadButton} ${styles.right}`}
        aria-label="Move right"
      >
        →
      </button>
      <button
        type="button"
        onClick={() => onDirection(1)}
        className={`${styles.dpadButton} ${styles.down}`}
        aria-label="Move down"
      >
        ↓
      </button>
    </div>
  );
}
