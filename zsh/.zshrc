# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# ---------- Homebrew ----------

eval "$(/opt/homebrew/bin/brew shellenv)"


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

alias vim="nvim"

alias cw="cd ~/code/work/"
alias cl="cd ~/code/learning/"
alias cs="cd ~/code/scratch/"


# ---------- fzf ----------

source <(fzf --zsh)

# ---------- eza ----------

alias ls="eza --icons"
alias ll="eza -lah --icons"
alias la="eza -a --icons"
alias lt="eza --tree --icons"

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

