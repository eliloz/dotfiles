# Every zsh, including scripts. rustup puts ~/.cargo/bin on PATH here so cargo works everywhere.
[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"

# ~/.local/bin: dotfiles scripts (dev, box) and the agent tools (factory, lab, bench), so
# scripts and agent shells find them too. Added only if missing; .zshrc moves it to the front.
[[ ":$PATH:" == *":$HOME/.local/bin:"* ]] || export PATH="$HOME/.local/bin:$PATH"
