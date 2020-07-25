#!/bin/bash

# Set your environment variables here if needed
if [ -z "$JAVA_HOME" ]
then
    # JAVA_HOME is undefined so set JAVA_HOME here
    export JAVA_HOME="<YOUR_JAVA_HOME_PATH>"
else
    echo "JAVA_HOME="$JAVA_HOME
fi
if [ -z "$OPENBEXI_TIMELINE_HOME" ]
then
    # OPENBEXI_TIMELINE_HOME is undefined so set JAVA_HOME here
    export OPENBEXI_TIMELINE_HOME="<YOUR_OPENBEXI_TIMELINE_HOME_PATH>"
else
    echo "OPENBEXI_TIMELINE_HOME="$OPENBEXI_TIMELINE_HOME
fi
if [ -z "$OPENBEXI_TIMELINE_DATA_PATH" ]
then
    # OPENBEXI_TIMELINE_DATA_PATH is undefined so set JAVA_HOME here
    export OPENBEXI_TIMELINE_DATA_PATH="<YOUR_OPENBEXI_TIMELINE_DATA_PATH>"
else
    echo "OPENBEXI_TIMELINE_DATA_PATH="$OPENBEXI_TIMELINE_DATA_PATH
fi


$JAVA_HOME/bin/java -classpath $OPENBEXI_TIMELINE_HOME/lib/openbexi_timeline.jar com.openbexi.timeline.server.openbexi_timeline -data_path $OPENBEXI_TIMELINE_DATA_PATH
