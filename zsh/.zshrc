# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# ---------- PATH ----------

# User scripts (stowed from dotfiles/scripts) and uv tools. typeset -U drops duplicate entries.
typeset -U path
path=("$HOME/.local/bin" $path)


# ---------- History ----------

HISTFILE="$HOME/.zsh_history"
HISTSIZE=10000
SAVEHIST=10000

setopt HIST_IGNORE_DUPS
setopt SHARE_HISTORY


# ---------- Completion ----------

# Docker CLI completions (must be on fpath before compinit)
fpath=("$HOME/.docker/completions" $fpath)

autoload -Uz compinit
compinit


# ---------- Editor ----------

export EDITOR="nvim"
export VISUAL="nvim"

# zsh switches the line editor to vi mode when EDITOR/VISUAL contains "vi".
# Force emacs keybindings instead.
bindkey -e

# tmux runs with extended-keys always, so Shift+Space / Shift+Enter arrive as
# escape sequences (ESC [27;2;<key>~). Map them back to plain space / Enter.
bindkey -s '^[[27;2;32~' ' '
bindkey '^[[27;2;13~' accept-line

alias vim="nvim"

alias cw="cd ~/code/work/"
alias cl="cd ~/code/learning/"
alias cs="cd ~/code/scratch/"


# ---------- fzf ----------

source <(fzf --zsh)

# ---------- ls ----------

# macOS ls is BSD ls: it only colors output when CLICOLOR is set.
export CLICOLOR=1

alias ll="ls -lAh"
alias la="ls -A"

# ---------- Powerlevel10k ----------

source "$(brew --prefix)/share/powerlevel10k/powerlevel10k.zsh-theme"

# ---------- mise ----------

eval "$(mise activate zsh)"

# ---------- Plugins ----------

source "$(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh"

# Ctrl+Space accepts the current autosuggestion
bindkey '^ ' autosuggest-accept

source "$(brew --prefix)/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
ZSH_HIGHLIGHT_STYLES[path]='none'


# ---------- Powerlevel10k configuration ----------

[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh


# ---------- Local overrides (not in git) ----------

[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

