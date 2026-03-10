- "session" - a full session of using vibeduel - a session is composed of duel rounds or normal single-model turns
- "duel round" - starts when a user toggles duel mode and enters an initial message. end when the user submits a vote for one of the slots/agents. prior to submitting a vote, the user can submit follow-ups messages to individual slots.
- your api key lives in ~/.local/share/vibeduel/auth.json
- the box for each agent is called a SessionPane
- the component where you type your prompt in ("prompt box") is called Prompt
- the place where the SessionPanes and Prompt are is called the Session formally, but you can call it the workspace/viewport
- session_tracking_number - one per time you start a new chat (ie if you vote and then start a new round, both rounds will have the same session_tracking_number)
- session_id - one per duel round (ie if you vote and then start a new round, both rounds will have a different session_id)
- x-opencode-session - one per side in a duel round - used to tell server which side is which


theres two sets of buttons for duels. 
1. this one is at the top and is effectively a navbar for the user to navigate between slots. theres num_slots buttons that they can click to navigate. once theyve submitted a vote, these buttons collapse into a single "fake button" that displays the name of the winning model.
2. this one is at the bottom and is a set of buttons that the user can click to pick which model to vote for, and submit their vote to the model that theyve picked. 

