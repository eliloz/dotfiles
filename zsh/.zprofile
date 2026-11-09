# Login shells (every Ghostty window and tmux pane). PATH and environment go here;
# interactive setup (prompt, plugins, mise activate) lives in .zshrc.

# ---------- Homebrew ----------
eval "$(/opt/homebrew/bin/brew shellenv)"
# Let `brew bundle` find the dotfiles Brewfile from any directory.
export HOMEBREW_BUNDLE_FILE="$HOME/dotfiles/Brewfile"

# ---------- PATH ----------
# JetBrains Toolbox launcher scripts (idea, pycharm, dataspell). Toolbox may re-add this line.
export PATH="$PATH:$HOME/Library/Application Support/JetBrains/Toolbox/scripts"
# Lean toolchain (elan)
export PATH="$HOME/.elan/bin:$PATH"
