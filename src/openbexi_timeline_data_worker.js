import {parseTimelineData} from './openbexi_timeline_data_parser.js';

// One worker belongs to one load. Terminating it immediately cancels parsing or
// normalization without allowing an older load to replace the current data.
self.onmessage = async ({data: {input, source}}) => {
    try {
        const text = typeof input === 'string' ? input : await input.text();
        self.postMessage({type: 'result', dataset: parseTimelineData(text, source)});
    } catch (error) {
        self.postMessage({type: 'error', message: error.message || 'Unable to process the dataset.'});
    }
};
