/** Keep legacy patterns unchanged; advanced syntax is explicitly prefixed expr:. */
export const decodeFilter = value => String(value ?? '').replaceAll('_PIPE_','|').replaceAll('_PLUS_','+')
    .replaceAll('_PERC_','%').replaceAll('_PARL_','(').replaceAll('_PARR_',')');

export function compileFilter(encoded='') {
    const source=decodeFilter(encoded);
    if(source.length>4096)throw new Error('Filter exceeds 4096 characters.');
    if(!source.startsWith('expr:')) {
        if(!source)return ()=>true;
        const [include='',exclude='']=source.split('|');
        const compile=part=>part?part.split(';').map(group=>group.split('+').map(term=>({
            pattern:new RegExp(term),literal:term.startsWith('description:')?term.slice(12):null
        }))):[];
        let yes,no;
        try {yes=compile(include);no=compile(exclude);} catch {throw new Error('Invalid legacy regular expression.');}
        const matches=(groups,text)=>groups.some(group=>group.every(term=>term.pattern.test(text) || term.literal!==null && text.includes(term.literal)));
        return record=>{
            const text=JSON.stringify(record,(key,value)=>key==='sourceRecordKey'?undefined:value).replaceAll('"','');
            return (!include || matches(yes,text)) && !matches(no,text);
        };
    }
    const tokens=[];
    const error=(offset,message)=>new Error(`Filter at character ${offset+1}: ${message}`);
    for(let i=5;i<source.length;) {
        let c=source[i];if(/\s/.test(c)){i++;continue;}
        const offset=i;
        if(c==='"' || c==="'") {
            const quote=c;let value='',closed=false;i++;
            while(i<source.length) {
                c=source[i++];if(c===quote){closed=true;break;}
                if(c==='\\') {
                    if(i===source.length)throw error(i-1,'Incomplete escape.');
                    c=source[i++];
                    const escaped={n:'\n',r:'\r',t:'\t','\\':'\\','"':'"',"'":"'"};
                    if(!Object.hasOwn(escaped,c))throw error(i-1,'Use \\n, \\r, \\t, or an escaped quote or backslash.');
                    value+=escaped[c];
                } else value+=c;
            }
            if(!closed)throw error(offset,'Unclosed quoted value.');
            tokens.push({text:source.slice(offset,i),value,offset,literal:true});
        } else if('(),'.includes(c))tokens.push({text:c,offset:i++});
        else if('=!<>'.includes(c)) {i++;if(source[i]==='=')i++;tokens.push({text:source.slice(offset,i),offset});}
        else {
            while(i<source.length && !/\s/.test(source[i]) && !'(),=!<>"\''.includes(source[i]))i++;
            tokens.push({text:source.slice(offset,i),offset});
        }
        if(tokens.length>512)throw error(offset,'Too many terms (maximum 512 tokens).');
    }
    tokens.push({text:'',offset:source.length});
    let index=0,depth=0;
    const peek=()=>tokens[index];
    const take=text=>{if(!peek().literal && peek().text.toUpperCase()===text){index++;return true;}return false;};
    const require=text=>{if(!take(text))throw error(peek().offset,`Expected '${text}'.`);};
    const name=()=>{
        const token=peek();if(token.literal || !/^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(token.text))throw error(token.offset,'Expected a field name.');
        index++;return token.text;
    };
    const literal=()=>{
        const token=peek(),text=token.text;
        if(token.literal){index++;return token.value;}
        if(!text || [',',')','(','AND','OR','NOT'].includes(text.toUpperCase()))throw error(token.offset,'Expected a value; quote text containing spaces or operators.');
        index++;
        if(/^null$/i.test(text))return null;
        if(/^(true|false)$/i.test(text))return text.toLowerCase()==='true';
        if(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text)) {
            const value=Number(text);if(!Number.isFinite(value))throw error(token.offset,'Number must be finite.');return value;
        }
        if(!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(text))throw error(token.offset,'Quote this text value.');
        return text;
    };
    const field=(record,path)=>{
        const parts=path.split('.');let value=Object.hasOwn(record,parts[0])?record:record.data;
        for(const part of parts) {
            if(!value || typeof value!=='object' || !Object.hasOwn(value,part))return undefined;
            value=value[part];
        }
        return value;
    };
    const compare=(left,op,right)=>{
        if(left===undefined)return false;
        if(op==='=' || op==='==')return left===right;
        if(op==='!=')return left!==right;
        if(left===null || right===null || typeof left!==typeof right)return false;
        if(['CONTAINS','STARTS_WITH','ENDS_WITH'].includes(op))return typeof left==='string' &&
            (op==='CONTAINS'?left.includes(right):op==='STARTS_WITH'?left.startsWith(right):left.endsWith(right));
        if(!['number','string'].includes(typeof left))return false;
        return op==='>'?left>right:op==='>='?left>=right:op==='<'?left<right:left<=right;
    };
    const unary=()=>{
        if(++depth>32)throw error(peek().offset,'Expressions may nest up to 32 levels.');
        try {
            if(take('NOT')){const inner=unary();return record=>!inner(record);}
            if(take('(')){const inner=or();require(')');return inner;}
            if(take('EXISTS')){require('(');const key=name();require(')');return record=>field(record,key)!==undefined;}
            const key=name(),token=peek(),op=token.text.toUpperCase();index++;
            if(op==='IN') {
                require('(');const values=[literal()];while(take(','))values.push(literal());require(')');
                return record=>values.includes(field(record,key));
            }
            if(!['=','==','!=','>','>=','<','<=','CONTAINS','STARTS_WITH','ENDS_WITH'].includes(op))throw error(token.offset,'Expected a comparison, CONTAINS, STARTS_WITH, ENDS_WITH, or IN.');
            const value=literal();return record=>compare(field(record,key),op,value);
        } finally {depth--;}
    };
    const and=()=>{let result=unary();while(take('AND')){const left=result,right=unary();result=record=>left(record)&&right(record);}return result;};
    const or=()=>{let result=and();while(take('OR')){const left=result,right=and();result=record=>left(record)||right(record);}return result;};
    const result=or();if(peek().text)throw error(peek().offset,'Unexpected token.');return result;
}

export const filterSyntax = `Legacy: include|exclude. Semicolon (;) means OR; plus (+) means AND. Exclusion wins. Terms are case-sensitive regular expressions over the whole event/session, including its activities.
Examples: status:STARTED;status:SCHEDULE   or   namespace:operations|status:CANCELLED

Advanced: start with expr: to keep legacy expressions unchanged.
expr: namespace = "operations" AND (status IN ("STARTED", "SCHEDULE") OR priority >= 3)
expr: NOT status = "CANCELLED" AND title CONTAINS "Ground station"
expr: EXISTS(data.owner) AND data.owner STARTS_WITH "Team"

Operators: =, ==, !=, >, >=, <, <=, CONTAINS, STARTS_WITH, ENDS_WITH, IN, EXISTS(field).
Precedence: parentheses, NOT, AND, OR. Keywords ignore case; field names and text values are case-sensitive. Use dotted fields (data.owner); bare fields also look in data. Numbers and booleans are typed. Quote timestamps and values containing spaces or punctuation; use backslash to escape quotes or backslashes. Missing fields do not match comparisons; EXISTS distinguishes missing from null.
Each top-level event or session is filtered as a unit; matching sessions retain their activities. Sort by remains an independent saved filter setting.
Maximum: 4096 characters, 512 tokens, 32 nested levels.`;
