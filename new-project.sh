#!/usr/bin/env bash
# Usage: ./new-project.sh my-project-name
set -e
NAME="$1"
if [ -z "$NAME" ]; then echo "Usage: ./new-project.sh <project-name>"; exit 1; fi
if [ -e "$NAME" ]; then echo "'$NAME' already exists."; exit 1; fi
cp -R _template "$NAME"
DATE=$(date +%Y-%m-%d)
find "$NAME" -type f -name "*.md" | while read -r f; do
  sed -i.bak "s/{{PROJECT_NAME}}/$NAME/g; s/{{DATE}}/$DATE/g" "$f" && rm "$f.bak"
done
echo "Created $NAME/. Don't forget to add it to the README index."
