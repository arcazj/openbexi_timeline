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
# Array of directories to process and namespace mapping
declare -A namespace_map=(
    ["vm-fdc11"]="ESOC"
    ["vm-fdc12"]="ESOC"
    ["vm-fdc13"]="ESOC"
    ["vm-fdc14"]="ESOC"
    ["vm-fdc15"]="ESOC"
    ["vm-fdc21"]="LSOC"
    ["vm-fdc22"]="LSOC"
    ["vm-fdc23"]="LSOC"
    ["vm-fdc24"]="LSOC"
    ["vm-fdc25"]="LSOC"
    ["vmit-fdc51"]="MCC"
    ["vmit-fdc52"]="MCC"
    ["vmit-fdc53"]="MCC"
    ["vmit-fdc54"]="MCC"
    ["vmit-fdc55"]="MCC"
)

dirs_to_process=("vm-fdc11" "vm-fdc12" "vm-fdc13" "vm-fdc14" "vm-fdc15" "vm-fdc21" "vm-fdc22" "vm-fdc23" "vm-fdc24" "vm-fdc25" "vmit-fdc51" "vmit-fdc52" "vmit-fdc53" "vmit-fdc54" "vmit-fdc55")

# Loop over directories to process
for dir in "${dirs_to_process[@]}"; do
    namespace=${namespace_map[$dir]}
    for (( MONTHS=FIRST_MONTH; MONTHS<=LAST_MONTH; MONTHS++ )); do
        month=$(printf "%02d" "$MONTHS")
        for (( DAY=FIRST_DAY; DAY<=LAST_DAY; DAY++ )); do
            day=$(printf "%02d" "$DAY")
            FULL_PATH="/fdc_logs/ESOC/${YEAR}/${YEAR}_${month}_${day}/${dir}/"

            if [ -d "$FULL_PATH" ]; then
                # Find and search for the specified patterns
                find "${FULL_PATH}" -type f \( -name "kernel*.gz" -o -name "opk*.gz" -o -name "kernel*.log" -o -name "opk*.log" -o -name "prep*.log" -o -name "prep*.gz" \) -exec sh -c '
                    YEAR="$1"
                    month="$2"
                    day="$3"
                    dir="$4"
                    namespace="$5"
                    shift 5
                    for file in "$@"; do
                        if [[ "$file" == *.gz ]]; then
                            output=$(zgrep -H -E "Impossible to connect" "$file")
                        else
                            output=$(grep -H -E "Impossible to connect" "$file")
                        fi
                        if [[ -n "$output" ]]; then
                            # Extract the first timestamp from the description
                            timestamp=$(echo "$output" | grep -oP "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}" | head -n 1)
                            # Convert the timestamp to the desired format
                            start_time=$(date -d "$timestamp" "+%b %d %H:%M:%S %Y")
                            # Convert the timestamp to a long integer
                            startdateL=$(date -d "$timestamp" +%s)
                            id=$(uuidgen)
                            json_dir="/fdc_logs/ESOC/GNS_data/${YEAR}/${month}/${day}/"
                            mkdir -p "$json_dir"
                            json_file="${json_dir}ORACLE_${startdateL}.json"
                            echo "{
  \"dateTimeFormat\": \"iso8601\",
  \"events\": [
    {
      \"namespace\": \"$namespace\",
      \"data\": {
        \"hostname\": \"$dir\",
        \"system\": \"ORACLE\",
        \"description\": \"${output//\"/\\\"}\",
        \"title\": \"DB locked\",
        \"status\": \"CRITICAL\"
      },
      \"start\": \"$start_time\",
      \"end\": \"\",
      \"id\": \"$id\",
      \"render\": {
        \"image\": \"icon/ob_error.png\",
        \"color\": \"#f31733\"
      }
    }
  ]
}" > "$json_file"
                        fi
                    done
                ' sh "$YEAR" "$month" "$day" "$dir" "$namespace" {} +
            fi
        done
    done
done
