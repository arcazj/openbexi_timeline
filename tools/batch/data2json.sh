#!/usr/bin/env bash

################################################################################
# File:         data2json.sh
# Description:  Convert log data to json format
################################################################################

[[ ${GNS_ADMIN} ]] || { echo "ERROR: GNS_ADMIN not set."; exit 1; }

source ${GNS_ADMIN}/share/startup.sh &> /dev/null || \
{ echo "ERROR: Unable to source ${GNS_ADMIN}/share/startup.sh"; exit 1; }

################################################################################
# Libraries
################################################################################
source ${GNS_ADMIN}/lib/sh/libfunctions.sh

################################################################################
# Parse Command Line
################################################################################
usage()
{
    echo "usage: $(basename $0) [platform] [start] <options>"
    echo
    echo "Convert log data to json format"
    echo
    echo "positional arguments:"
    echo "  platform              platform name (ex. SOC, POV, MCC)"
    echo "  start                 start date (ex. 2024_05_03)"
    echo
    echo "optional arguments:"
    echo "  -h, --help            show this help message and exit"
    echo
    echo "Report bugs or issues to <soe-gns@intelsat.com>."
    echo
    exit 1
}

# Initialize command line arguments
POSITIONAL_COUNT=2
ARG_POSITIONAL=()
ARG_HELP=FALSE

# Read optional arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case ${key} in
        -h|--help)      ARG_HELP=TRUE; shift;;
        *)              ARG_POSITIONAL+=("$1"); shift;;
    esac
done

# Set positional arguments
set -- "${ARG_POSITIONAL[@]}"
ARG_PLATFORM=${ARG_POSITIONAL[0]}
ARG_DATE=${ARG_POSITIONAL[1]}

# Verify positional arguments
if [[ ${ARG_HELP} == TRUE || ${#ARG_POSITIONAL[@]} == 0 ]]; then
    usage
elif [[ ${#ARG_POSITIONAL[@]} -ne ${POSITIONAL_COUNT} ]]; then
    error_exit "Invalid number of arguments"
fi

################################################################################
# Checks and Verifications
################################################################################


################################################################################
# Main
################################################################################
JAVA_HOME=${JAVA_HOME:="/opt/IDE/jdk-18.0.2/"}
OPENBEXI_TIMELINE_HOME=${OPENBEXI_TIMELINE_HOME:="/home/scc/openbexi_timeline_V1"}

# Set OPENBEXI_TIMELINE_DATA_PATH based on PLATFORM
case ${ARG_PLATFORM} in
    MCC)
        OPENBEXI_TIMELINE_DATA_PATH="${OPENBEXI_TIMELINE_HOME}/yaml/GNS_MCC_sources_startup.yml"
    ;;
    SOC|ESOC|LSOC)
        OPENBEXI_TIMELINE_DATA_PATH="${OPENBEXI_TIMELINE_HOME}/yaml/GNS_SOC_sources_startup.yml"
    ;;
    POV)
        OPENBEXI_TIMELINE_DATA_PATH="${OPENBEXI_TIMELINE_HOME}/yaml/GNS_POV_sources_startup.yml"
    ;;
    ISAM)
        OPENBEXI_TIMELINE_DATA_PATH="${OPENBEXI_TIMELINE_HOME}/yaml/GNS_ISAM_sources_startup.yml"
    ;;
    *)
        error_exit "Invalid PLATFORM ${ARG_PLATFORM} specified"
    ;;
esac

# NOTE: This is needed because it expects the file "json/GNS_reports.json" in the working directory. It can be removed
#       once this issue is fixed.
# TODO: This is a workaround the JC needs to fix.
cd ${OPENBEXI_TIMELINE_HOME} || error_exit "Unable to change directory into ${OPENBEXI_TIMELINE_HOME}"

${JAVA_HOME}/bin/java -classpath ${OPENBEXI_TIMELINE_HOME}/lib/openbexi_timeline_new.jar com.intelsat.timeline.data2json \
 -data_path ${OPENBEXI_TIMELINE_DATA_PATH} "${ARG_DATE}"

zip -d $OPENBEXI_TIMELINE_HOME/lib/openbexi_timeline_new.jar 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.DSA'
${JAVA_HOME}/bin/java -classpath ${OPENBEXI_TIMELINE_HOME}/lib/openbexi_timeline_new.jar com.intelsat.timeline.data2json \
-data_conf ${OPENBEXI_TIMELINE_DATA_PATH} "${ARG_DATE}"

cd - || error_exit "Unable to change directory into previous working directory"
