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
    FIRST_MONTH=${3:-$current_month}
    LAST_MONTH=${4:-$current_month}
    FIRST_DAY=$current_day
    LAST_DAY=$current_day
elif [ "$1" == "yesterday" ]; then
    YEAR=$yesterday_year
    MONTH=$yesterday_month
    FIRST_MONTH=${3:-$current_month}
    LAST_MONTH=${4:-$current_month}
    FIRST_DAY=$yesterday_day
    LAST_DAY=$yesterday_day
else
    YEAR="${1:-$current_year}"
    MONTH="${2:-$current_month}"
    FIRST_MONTH=1
    LAST_MONTH=12
    FIRST_DAY=1
    LAST_DAY=31
fi

LOG_DIR1="/fdc_logs/ESOC/${YEAR}/${YEAR}"
LOG_DIR2="/fdc_logs/POV/${YEAR}/${YEAR}"
LOG_DIR3="/fdc_logs/MCC_RH7/${YEAR}/${YEAR}"

# Array of directories to process
log_dirs=("$LOG_DIR1" "$LOG_DIR2" "$LOG_DIR3")

# Array of directories inside the log directories
dirs_to_process=("vm-fdc11" "vm-fdc12" "vm-fdc13" "vm-fdc14" "vm-fdc15" "vm-fdc21" "vm-fdc22" "vm-fdc23" "vm-fdc24" "vm-fdc25" "vmit-fdc51" "vmit-fdc52" "vmit-fdc53" "vmit-fdc54" "vmit-fdc55")

# Loop over log directories
for log_dir in "${log_dirs[@]}"; do
    for (( MONTHS=FIRST_MONTH; MONTHS<=LAST_MONTH; MONTHS++ )); do
        month=$(printf "%02d" "$MONTHS")
        # Loop over each day in the range
        for (( DAY=FIRST_DAY; DAY<=LAST_DAY; DAY++ )); do
            day=$(printf "%02d" "$DAY")
            for dir in "${dirs_to_process[@]}"; do
                FULL_PATH="${log_dir}_${month}_${day}/$dir/ope/"
                if [ -d "$FULL_PATH" ]; then
			find "${FULL_PATH}" -type f \( -name "kernel*.gz" -o -name "opk*.gz" -o -name "kernel*.log" -o -name "opk*.log" -o -name "prep*.log" -o -name "prep*.gz"  \) -exec sh -c '
    for file; do
        if [[ "$file" == *.gz ]]; then
            zgrep -H -E "ORA-|Impossible" "$file"
            #zgrep -H -E "Impossible" "$file"
        else
            #grep -H -E "Impossible" "$file"
            grep -H -E "ORA-|Impossible" "$file"
        fi
    done
' sh {} +


                fi
            done
        done
    done
done
