import GameCanvas from "@/components/GameCanvas";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.main}>
      <h1 className={styles.title}>Multiplayer Snake</h1>
      <GameCanvas />
    </div>
  );
}
