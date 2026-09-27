/** Declarative presentation contract. Engine safety limits and runtime state stay in code. */
const number = (value, minimum, maximum, description) => ({type:'number',default:value,minimum,maximum,description});
const color = (value, description) => ({type:'string',default:value,minLength:1,maxLength:80,pattern:'^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|hsl)a?\\([0-9.,% +\\-]+\\))$',description});
const optionalColor = description => ({...color('#ffffff',description),type:['string','null'],default:null});
const choice = (value, values, description) => ({type:'string',default:value,enum:values,description});
const bool = (value, description) => ({type:'boolean',default:value,description});
const text = (value, description) => ({type:'string',default:value,minLength:1,maxLength:160,description});
const group = (description, properties) => ({type:'object',additionalProperties:false,description,properties});
export const RENDERING_SCHEMA = group('Optional rendering settings. Omitted properties retain the existing presentation.', {
    theme:group('Scene and optional application surface colors.',{
        sceneBackground:color('#f7f9fc','Canvas background.'),
        headerBackground:optionalColor('Header background; null keeps the stylesheet theme.'),
        panelBackground:optionalColor('Timeline panel background; null keeps the stylesheet theme.'),
        panelText:optionalColor('Panel text color; null keeps the stylesheet theme.')
    }),
    axis:group('Date axes and automatic tick spacing.',{
        background:color('#f7f9fc','Date axis and date-label background.'),
        separatorColor:color('#8090a0','Date-axis boundary color.'),
        textColor:color('#233449','Date label color.'),
        minimumHeight:number(28,16,160,'Minimum date-axis height in pixels.'),
        verticalPadding:number(16,0,80,'Additional axis height above the band font size.'),
        minimumFontSize:number(12,6,48,'Minimum canvas date-label font size in pixels.'),
        targetTickPixels:number(100,30,400,'Preferred distance between automatically chosen time labels.'),
        groupHeaderHeight:number(24,12,120,'Space reserved for a group heading.'),
        scaleHeaderColor:color('#edf0f1','Default scale-header background.'),
        scaleHeaderText:color('#397a9c','Default scale-header text.'),
        secondaryColor:color('#ffd58a','Default secondary-scale background.'),
        secondaryText:color('#704308','Default secondary-scale text.')
    }),
    overview:group('Overview SVG labels, markers and visible-range indicators.',{
        borderColor:color('#aab8bf','Top divider.'),
        headingColor:color('#566871','Heading and record-count text.'),
        headingFontSize:number(11,6,32,'Default overview heading size.'),
        countFontSize:number(10,6,32,'Record-count size.'),
        axisFontSize:number(10,6,32,'Overview date-label size.'),
        markerStroke:color('#253746','Record marker outline.'),
        markerStrokeWidth:number(.35,0,8,'Record marker outline width.'),
        dimmedOpacity:number(.25,0,1,'Opacity multiplier for nonmatching records during search.'),
        matchColor:color('#ffe04b','Search-match fill.'),
        matchOpacity:number(.95,0,1,'Search-match opacity.'),
        matchStroke:color('#783800','Search-match outline and count text.'),
        matchStrokeWidth:number(2,0,8,'Search-match outline width.'),
        viewportColor:color('#ffffff','Visible-range fill.'),
        viewportOpacity:number(.08,0,1,'Visible-range fill opacity.'),
        viewportStroke:color('#536872','Visible-range outline.'),
        viewportStrokeWidth:number(1,0,8,'Visible-range outline width.'),
        handleColor:color('#eff8ff','Visible-range handle fill.'),
        handleStroke:color('#4d89ae','Visible-range handle outline.'),
        handleWidth:number(7,3,24,'Handle width in pixels.'),
        handleMaxHeight:number(48,12,120,'Maximum handle height in pixels.')
    }),
    camera:group('3D camera and lighting. Existing params.camera takes precedence for initial mode.',{
        mode:choice('Orthographic',['Orthographic','Perspective'],'Initial camera mode.'),
        fieldOfView:number(30,10,100,'Perspective field of view in degrees.'),
        yaw:number(-.42,-.65,.65,'Initial horizontal orbit angle in radians.'),
        pitch:number(.22,.06,.46,'Initial vertical orbit angle in radians.'),
        roll:number(-.12,-.5,.5,'Board rotation in radians.'),
        rotationSensitivity:number(.002,.0001,.02,'Shift-drag rotation per pixel.'),
        ambientColor:color('#ffffff','Perspective ambient light.'),
        ambientIntensity:number(1.5,0,5,'Perspective ambient light intensity.'),
        directionalColor:color('#ffffff','Perspective directional light.'),
        directionalIntensity:number(1.8,0,5,'Perspective directional light intensity.')
    }),
    activity:group('Activity labels, 3D materials and selection brightness. Selection never enlarges activities.',{
        labelMinWidth:number(80,20,400,'Minimum wrapping width in pixels.'),
        labelMaxWidth:number(360,40,1600,'Maximum wrapping width in pixels.'),
        labelHorizontalPadding:number(24,0,200,'Space reserved around labels.'),
        lineHeight:number(1.25,1,3,'Label line-height multiplier.'),
        shininess:number(24,0,100,'3D activity material shininess.'),
        shadowColor:color('#17363d','3D activity shadow.'),
        shadowOpacity:number(.16,0,1,'3D activity shadow opacity.'),
        laneOpacity:number(.08,0,1,'3D row lane opacity.'),
        glowColor:color('#ffca28','Selected activity glow.'),
        glowOutline:color('#ae5b00','Selected activity glow outline.'),
        glowOpacity:number(.22,0,1,'Selected activity resting glow opacity.'),
        glowPulse:number(.12,0,1,'Additional glow opacity during the selection pulse.'),
        transitionMs:number(850,0,5000,'Selection pulse duration; zero disables animation.'),
        matchBackground:color('#fff6bd','Matching activity label background.'),
        leaderColor:color('#507585','3D label connector.'),
        selectedLeaderColor:color('#9c5900','Selected label connector.')
    }),
    layout:group('Responsive layout preferences; computed positions and page membership are not persisted.',{
        sidebarBreakpoint:number(900,320,2400,'Viewport width below which the Data panel overlays the plot.'),
        sidebarMinimum:number(320,180,800,'Minimum docked Data panel width.'),
        sidebarDefaultMaximum:number(480,180,1400,'Maximum initial Data panel width.'),
        sidebarDefaultRatio:number(.22,.1,.7,'Initial Data panel width relative to the viewport.'),
        sidebarMaximumRatio:number(.6,.2,.85,'Maximum docked Data panel width relative to the viewport.'),
        minimumPlotWidth:number(420,80,1200,'Space retained next to a docked Data panel.'),
        overviewMaxHeight:number(180,40,800,'Maximum height per docked overview.'),
        minimumDetailHeight:number(100,40,800,'Space retained above the overview.'),
        splitRatio:number(.5,.2,.8,'Timeline share of the split view width.')
    }),
    interaction:group('Initial search preferences and user navigation increments. Saved/URL state still takes precedence.',{
        searchMode:choice('highlight',['highlight','only'],'Initial search presentation.'),
        highlight:bool(true,'Highlight matching activities.'),
        autoScale:bool(false,'Enable density-based scaling initially.'),
        adaptiveRatio:number(8,1,16,'Maximum initial adaptive scaling ratio.'),
        zoomInFactor:number(.8,.1,.99,'Zoom-in span multiplier.'),
        zoomOutFactor:number(1.25,1.01,10,'Zoom-out span multiplier.'),
        overviewPanFraction:number(.5,.05,1,'Overview button navigation fraction.'),
        overviewKeyboardFraction:number(.1,.01,1,'Overview arrow-key navigation fraction.'),
        resizeStep:number(20,1,100,'Data panel keyboard resize step in pixels.'),
        resizeLargeStep:number(50,1,300,'Shift-arrow resize step in pixels.')
    }),
    controls:group('Labels for existing, approved view and overview actions.',{
        timelineLabel:text('Timeline','Timeline view button label.'),
        tableLabel:text('Table','Table view button label.'),
        splitLabel:text('Split','Split view button label.'),
        previousOverviewLabel:text('\u2190','Overview previous button label.'),
        previousOverviewTitle:text('Navigate earlier','Overview previous button tooltip.'),
        nextOverviewLabel:text('\u2192','Overview next button label.'),
        nextOverviewTitle:text('Navigate later','Overview next button tooltip.'),
        fitOverviewLabel:text('Fit context','Fit overview button label.'),
        fitOverviewTitle:text('Fit loaded context in Overview','Fit overview button tooltip.')
    }),
    table:group('Table columns and details links.',{
        emptyText:text('No events to display.','Empty table message.'),
        columns:{type:'array',minItems:1,maxItems:20,description:'Columns in display order; field is a supported record value.',default:[
            {field:'title',label:'Title'},{field:'start',label:'Start'},{field:'end',label:'End'},
            {field:'source',label:'Source'},{field:'status',label:'Status'}],items:{type:'object',additionalProperties:false,required:['field','label'],properties:{
                field:{type:'string',enum:['title','start','end','source','status','description','id']},
                label:{type:'string',minLength:1,maxLength:80},width:{type:'number',minimum:40,maximum:1200},
                visible:{type:'boolean',default:true}
            }}}
    })
});

function defaults(schema) {
    if(schema.type==='object') return Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,defaults(value)]));
    return structuredClone(schema.default);
}
function freeze(value) {if(value && typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const RENDERING_DEFAULTS=freeze(defaults(RENDERING_SCHEMA));

/** Also validates provider models, which deliberately retain their legacy extension fields. */
export function validateRendering(value) {
    const issues=[];
    const check=(schema,input,path)=>{
        if(input===undefined)return;
        const types=[].concat(schema.type || []),type=input===null?'null':Array.isArray(input)?'array':typeof input;
        if(types.length && !types.includes(type)) {issues.push({path,message:'must be '+types.join(' or ')});return;}
        if(type==='null')return;
        if(type==='object') {
            for(const key of schema.required || [])if(input[key]===undefined)issues.push({path:path+'.'+key,message:'is required'});
            for(const [key,child] of Object.entries(input)) {
                if(!Object.hasOwn(schema.properties,key))issues.push({path:path+'.'+key,message:'is not a supported rendering property'});
                else check(schema.properties[key],child,path+'.'+key);
            }
        } else if(type==='array') {
            if(input.length<schema.minItems || input.length>schema.maxItems)issues.push({path,message:'has an invalid number of items'});
            input.forEach((child,i)=>check(schema.items,child,path+'['+i+']'));
        } else if(type==='number' && (!Number.isFinite(input) || input<schema.minimum || input>schema.maximum))issues.push({path,message:`must be between ${schema.minimum} and ${schema.maximum}`});
        else if(type==='string' && (input.length<(schema.minLength || 0) || input.length>(schema.maxLength || Infinity) || schema.pattern && !new RegExp(schema.pattern).test(input)))issues.push({path,message:'has an invalid format'});
        if(schema.enum && !schema.enum.includes(input))issues.push({path,message:'must be one of '+schema.enum.join(', ')});
    };
    check(RENDERING_SCHEMA,value,'$.rendering');
    if((value?.activity?.labelMinWidth ?? RENDERING_DEFAULTS.activity.labelMinWidth)> (value?.activity?.labelMaxWidth ?? RENDERING_DEFAULTS.activity.labelMaxWidth))issues.push({path:'$.rendering.activity.labelMinWidth',message:'must not exceed labelMaxWidth'});
    if(value?.table?.columns && value.table.columns.every(column=>column.visible===false))issues.push({path:'$.rendering.table.columns',message:'must contain a visible column'});
    if(issues.length) {const error=new Error(issues.map(issue=>issue.path+' '+issue.message).join('; '));error.name='RenderingValidationError';error.issues=issues;throw error;}
    return value;
}
export function resolveRendering(value) {
    validateRendering(value);
    const merge=(base,change)=>Object.fromEntries(Object.entries(base).map(([key,item])=>[key,
        item && typeof item==='object' && !Array.isArray(item)?merge(item,change?.[key]):structuredClone(change?.[key]===undefined?item:change[key])]));
    return merge(RENDERING_DEFAULTS,value);
}
export const renderingFor=timeline=>timeline?.rendering || RENDERING_DEFAULTS;
export const bandRendering=band=>band?._rendering || RENDERING_DEFAULTS;
export function applyRenderingTheme(timeline) {
    const theme=renderingFor(timeline).theme;
    for(const [element,key,property] of [[timeline.ob_timeline_header,'headerBackground','background'],
        [timeline.ob_timeline_panel,'panelBackground','background'],[timeline.ob_timeline_panel,'panelText','color']])
        if(element && theme[key]!==null)element.style[property]=theme[key];
}
