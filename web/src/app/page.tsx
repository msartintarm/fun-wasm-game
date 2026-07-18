import GameCanvas from "@/components/GameCanvas";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-950 px-4 py-16 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
        Multiplayer Snake
      </h1>
      <GameCanvas />
    </div>
  );
}
