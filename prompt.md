claude -p "for context upon your current task you are constructing an allowlist of allowed commands. This is how we got here: I prompted you '


1.

Create a website with next.js which contains a game that is rendered with Web Assembly using Rust as the source language. The game should be a multiplayer version of Snake with the human controlling one snake and the AI controlling the other snakes. When close to the other snakes, you move faster and score more points. 

2. Prerequisite:

WIth -p mode, you hit repeated permission denials on npm, rustc, cargo, and wasm-pack version checks, so you must first create an allowlist for this repo w/ fewer-permission-prompts.

3. It is okay for you to run these tools autonomously, but only after the allowlist has been created.





The player should move relatively slowly and the playing space should be large. the screen should scroll along with the player. in terms of animation, the players should appear to smoothly move between the grid cells.
