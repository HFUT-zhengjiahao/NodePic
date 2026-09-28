#!/usr/bin/env bash
#
# 把 main 的内容发布到公开仓库（默认远端 nodepic → HFUT-zhengjiahao/NodePic）。
#
# 公开仓库里永远不含画布数据：generated-images/（生成的图片与登记表）、workspace-backup/、
# canvas-backups/、NOTES.local.md、.playground-settings.json 都会在生成快照时被剔除。
#
# 用法：
#     scripts/publish.sh                # 用当前 main 的内容发布
#     REMOTE=nodepic BRANCH=public scripts/publish.sh
#     scripts/publish.sh -n             # 只看会发布什么，不推送
#
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE=${REMOTE:-nodepic}
BRANCH=${BRANCH:-public}
SOURCE=${SOURCE:-main}
DRY_RUN=0
[ "${1:-}" = "-n" ] && DRY_RUN=1

# 这些路径永远不进公开仓库（与 .gitignore 保持一致）。
PRIVATE_PATHS=(generated-images workspace-backup canvas-backups NOTES.local.md .playground-settings.json)

if ! git rev-parse --verify --quiet "$SOURCE" >/dev/null; then
    echo "✗ 找不到分支 $SOURCE" >&2
    exit 1
fi
if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
    echo "✗ 没有配置远端 $REMOTE（git remote add $REMOTE git@github.com:<账号>/<仓库>.git）" >&2
    exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
    echo "✗ 工作区不干净，先提交或 stash 再发布" >&2
    exit 1
fi

# 在临时索引里拼出「main 的树 - 私有路径」，不碰工作区，也不切换分支。
INDEX=$(mktemp -t nodepic-publish.XXXXXX)
rm -f "$INDEX"
trap 'rm -f "$INDEX"' EXIT

export GIT_INDEX_FILE="$INDEX"
git read-tree "$SOURCE"
git rm -r --cached --ignore-unmatch -q "${PRIVATE_PATHS[@]}"
TREE=$(git write-tree)
unset GIT_INDEX_FILE

# 树没变就不产生空提交。
if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
    PREV_TREE=$(git rev-parse "refs/heads/$BRANCH^{tree}")
    PREV_COMMIT=$(git rev-parse "refs/heads/$BRANCH")
else
    PREV_TREE=""
    PREV_COMMIT=""
fi

if [ "$TREE" = "$PREV_TREE" ]; then
    echo "✓ 已经没有新内容需要发布（$BRANCH 与 $SOURCE 的公开内容一致）"
else
    SUBJECT=$(git log -1 --format=%s "$SOURCE")
    MESSAGE="Publish from $SOURCE: $SUBJECT"
    if [ -n "$PREV_COMMIT" ]; then
        COMMIT=$(git commit-tree "$TREE" -p "$PREV_COMMIT" -m "$MESSAGE")
    else
        COMMIT=$(git commit-tree "$TREE" -m "$MESSAGE")
    fi
    git update-ref "refs/heads/$BRANCH" "$COMMIT"
    echo "✓ 已生成发布快照 $BRANCH → $(git rev-parse --short "$COMMIT")"
    echo "  包含 $(git ls-tree -r "$BRANCH" --name-only | wc -l | tr -d ' ') 个文件；已剔除：${PRIVATE_PATHS[*]}"
fi

if [ "$DRY_RUN" = "1" ]; then
    echo "（-n：未推送）"
    exit 0
fi

git push "$REMOTE" "$BRANCH:main"
echo "✓ 已推送到 $REMOTE"
