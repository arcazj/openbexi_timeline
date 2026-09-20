#!/bin/bash

# Get current date and yesterday's date
current_date=$(date +%Y-%m-%d)
current_year=$(date +%Y)
current_month=$(date +%m)
current_day=$(date +%d)

yesterday_date=$(date -d "yesterday" +%Y-%m-%d)
yesterday_year=$(date -d "yesterday" +%Y)
yesterday_month=$(date -d "yesterday" +%m)
yesterday_day=$(date -d "yesterday" +%d)

# Determine if $1 is 'today' or 'yesterday', and set variables accordingly
if [ "$1" == "today" ]; then
    YEAR=$current_year
    MONTH=$current_month
    FIRST_DAY=$current_day
    LAST_DAY=$current_day
elif [ "$1" == "yesterday" ]; then
    YEAR=$yesterday_year
    MONTH=$yesterday_month
    FIRST_DAY=$yesterday_day
    LAST_DAY=$yesterday_day
else
    YEAR="${1:-$current_year}"
    MONTH="${2:-$current_month}"
    FIRST_DAY=${3:-$current_day}
    LAST_DAY=${4:-$current_day}
fi

LOG_DIR1="/fdc_logs/ESOC/${YEAR}/${YEAR}_${MONTH}"
LOG_DIR2="/fdc_logs/POV/${YEAR}/${YEAR}_${MONTH}"
LOG_DIR3="/fdc_logs/MCC_RH7/${YEAR}/${YEAR}_${MONTH}"

# Array of directories to process
log_dirs=("$LOG_DIR1" "$LOG_DIR2" "$LOG_DIR3")

# Array of directories inside the log directories
dirs_to_process=("vm-fdc11" "vm-fdc12" "vm-fdc13" "vm-fdc14" "vm-fdc15" "vm-fdc21" "vm-fdc22" "vm-fdc23" "vm-fdc24" "vm-fdc25" "vmit-fdc51" "vmit-fdc52" "vmit-fdc53" "vmit-fdc54" "vmit-fdc55")

# Loop over log directories
for log_dir in "${log_dirs[@]}"; do
    # Loop over each day in the range
    for (( i=FIRST_DAY; i<=LAST_DAY; i++ )); do
        day=$(printf "%02d" "$i")
        for dir in "${dirs_to_process[@]}"; do
            FULL_PATH="${log_dir}_${day}/$dir/"
            if [ -d "$FULL_PATH" ]; then
                # Find and search for "ORACLE" inside *.gz and *.log files starting with ope* or opk*
                find "${FULL_PATH}" -type f \( -name "ope*.gz" -o -name "opk*.gz" -o -name "ope*.log" -o -name "opk*.log" \) -exec sh -c '
                    for file do
                        if [[ "$file" == *.gz ]]; then
                            if zgrep -q "ORACLE" "$file"; then
                                echo "ORACLE found in: $file"
                            fi
                        else
                            if grep -q "ORACLE" "$file"; then
                                echo "ORACLE found in: $file"
                            fi
                        fi
                    done
                ' sh {} +
            fi
        done
    done
done
