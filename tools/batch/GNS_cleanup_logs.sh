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

# Array of strings to delete
DELETE_STRINGS=("L7" "L6" "l_tmin" "l_tmax" "attributes" "attName" "time = " "value = " "po_tobj " "attList" "- session " "Goals in Strategy goal list" "----------------------" "alternative resources")

# Loop over log directories
for log_dir in "${log_dirs[@]}"; do
    # Loop over each day in the range
 for (( MONTHS=FIRST_MONTH; MONTHS<=LAST_MONTH; MONTHS++ )); do
        month=$(printf "%02d" "$MONTHS")
    for (( i=FIRST_DAY; i<=LAST_DAY; i++ )); do
        day=$(printf "%02d" "$i")
        for dir in "${dirs_to_process[@]}"; do
            FULL_PATH="${log_dir}_${month}_${day}/$dir/dsm/"
            if [ -d "$FULL_PATH" ]; then
                cd "$FULL_PATH" || continue
                # Process each file in the directory
                for file in *; do
                    if [[ $file == *.gz ]]; then
                        echo "Processing gzipped file: $FULL_PATH/$file"
                        gzip -df "$file"
                        original_name="${file%.gz}"
                        for del_str in "${DELETE_STRINGS[@]}"; do
                            sed -i "/$del_str/d" "$original_name"
                        done
                        # Delete empty lines
                        sed -i '/^$/d' "$original_name"
                        gzip -f "$original_name"
                    elif [[ $file == *.log ]]; then
                        echo "No processing log file: $file"
                    fi
                done
            fi
        done
        # Find and compress files
        echo "Find and compress all files found under ${log_dir}_${month}_${day}"
        find "${log_dir}_${month}_${day}" -type f \( -name "*.log" -o -name "vm-eng*.com*" -o -name "vm-ops*.com*" \) ! -name "*.gz" -exec gzip -f {} +
    done
 done
done
