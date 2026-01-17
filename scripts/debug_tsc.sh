#!/bin/bash
echo "Running tsc..."
npx tsc --project tsconfig.json --noEmit
TSC_EXIT=$?
echo "TSC exit code: $TSC_EXIT"

if [ $TSC_EXIT -eq 0 ]; then
    echo "TSC check passed."
else
    echo "TSC check failed."
fi

echo "Checking dist content if we were to emit:"
npx tsc --project tsconfig.json --listFiles | grep "src/tasks/taskRepository.ts"
