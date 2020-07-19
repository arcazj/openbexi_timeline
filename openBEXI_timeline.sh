#!/bin/bash

# Set your environment variables here if needed
if [ -z "$JAVA_HOME" ]
then
    # JAVA_HOME is undefined so set JAVA_HOME here
    export JAVA_HOME=""
else
    echo "JAVA_HOME="$JAVA_HOME
fi
if [ -z "$OPENBEXI_TIMELINE_HOME" ]
then
    # OPENBEXI_TIMELINE_HOME is undefined so set JAVA_HOME here
    export OPENBEXI_TIMELINE_HOME=""
else
    echo "OPENBEXI_TIMELINE_HOME"$OPENBEXI_TIMELINE_HOME
fi
if [ -z "$OPENBEXI_TIMELINE_DATA_PATH" ]
then
    # OPENBEXI_TIMELINE_DATA_PATH is undefined so set JAVA_HOME here
    export OPENBEXI_TIMELINE_HOME=""
else
    echo "OPENBEXI_TIMELINE_DATA_PATH"$OPENBEXI_TIMELINE_DATA_PATH
fi


nohup $JAVA_HOME/bin/java -classpath $OPENBEXI_TIMELINE_HOME/lib/com.openbexi.timeline.server.openBEXI_timeline -data_path $OPENBEXI_TIMELINE_DATA_PATH &