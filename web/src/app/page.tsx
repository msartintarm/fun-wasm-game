import GameCanvas from "@/components/GameCanvas";
import { isE2EDebug } from "@/lib/env";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.main}>
      <h1 className={styles.title}>Chaos Snake</h1>
      <GameCanvas e2eDebug={isE2EDebug} />
    </div>
  );
}
