# Competitive notes

The MVP is deliberately narrower than general chess bots or full Lichess clients. Its differentiator is trustworthy post-game retrieval inside ChatGPT:

- no manual PGN upload or screenshot;
- explicit refusal of live and uncertain games;
- use of Lichess's existing public game data and analysis rather than paid server-side engine compute;
- bounded cost and failure domain;
- simple prompts such as “review this game” or “show my five newest completed games.”

An interactive board, recurring-mistake analysis, OAuth, and optional engine work remain future ideas and require separate product, fairness, security, and cost reviews.
