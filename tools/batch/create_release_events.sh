#!/bin/bash

# Define directory
BASE_DIR="/itdepot/GNS"
OUTPUT_DIR="/tmp/gns_output"
GNSPKG_HISTORY_CMD="/etc/intelsat/GNS/bin/gnspkg history"

# Ensure output directory exists
mkdir -p $OUTPUT_DIR

# Function to convert date to UTC format
convert_to_utc() {
  local date_str=$1
  date -u -d "$date_str" +"%a %b %d %T UTC %Y"
}

# Function to create JSON for each release
create_json() {
  local release=$1
  local start_date=$2
  local action=$3
  local profile=$GNS_PROFILE

  # Convert start date to UTC
  local start_date_utc=$(convert_to_utc "$start_date")

  # Determine status based on action
  local status="INFO"
  local pre_title="Install"
  local icon="install"
  if [[ "$action" == "uninstall" ]]; then
    status="WARNING"
    pre_title="Uninstall"
    icon="uninstall"
  fi

  # Find the info file
  local release_dir="$BASE_DIR/$release"
  local info_file=$(find "$release_dir" -name "*info*")

  # Read info file content
  local id=$(grep -i "id:" "$info_file" | awk '{print $2}')
  local title=$(grep -i "title:" "$info_file" | awk '{print $2}')
  local description=$(grep -i "description:" "$info_file" -A 10 | grep -v "description:")
  local rpm=$(grep -i "Files:" "$info_file" -A 10 | grep -v "Files:" )

# Create JSON content
  cat <<EOF >"$OUTPUT_DIR/$release.json"
{
  "dateTimeFormat": "iso8601",
  "events": [
    {
      "start": "$start_date_utc",
      "end": "",
      "id": "$id",
      "render": {
        "image": "icon\/ob_$icon.png",
        "color": "#f31733"
      },
      "data": {
        "title": "$pre_title $title",
        "namespace": "$profile",
        "system": "RPM",
        "status": "$status",
        "release": "$release",
        "install date": "$start_date",
        "description": "$rpm"
      }
    }
  ]
}
EOF
}

# Read GNSPKG history
$GNSPKG_HISTORY_CMD|tail -600 |grep GNS_ | while read -r line; do
  # Extract details from the history line
  release=$(echo $line | awk '{print $2}')
  action=$(echo $line | awk '{print $3}')
  start_date=$(echo $line | awk '{print $6, $7}')

  # Create JSON for each release
  create_json "$release" "$start_date" "$action"

  install_date=$start_date
  install_date2=$(echo "$start_date" | tr ' :' '__')
  year=$(date -d "$install_date" +"%Y")
  month=$(date -d "$install_date" +"%m")
  day=$(date -d "$install_date" +"%d")


  # Handle MCC profile special case
  if [ "$GNS_PROFILE" == "MCC" ]; then
    GNS_PROFILE2="${GNS_PROFILE}_RH7"
  fi

  echo "copy $OUTPUT_DIR/$release.json to vmit-webgns52:/fdc_logs/$GNS_PROFILE2/GNS_data/$year/$month/$day/$release$install_date2.json"
  scp "$OUTPUT_DIR/$release.json" "scc@vmit-webgns52:/fdc_logs/$GNS_PROFILE2/GNS_data/$year/$month/$day/$release$install_date2.json"
done
