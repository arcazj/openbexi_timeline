package com.openbexi.timeline.data_browser;

import org.json.simple.JSONObject;
import java.util.*;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/** Legacy session patterns and opt-in, typed expressions. Never evaluates code. */
public final class FilterExpression {
    private FilterExpression() {}
    public static final class Invalid extends IllegalArgumentException {
        public Invalid(String message) { super(message); }
    }
    public static String decode(String value) {
        return Objects.toString(value, "").replace("_PIPE_", "|").replace("_PLUS_", "+")
                .replace("_PERC_", "%").replace("_PARL_", "(").replace("_PARR_", ")");
    }
    public static Predicate<JSONObject> source(JSONObject source) {
        if(!(source.get("filter") instanceof Map<?,?> rules))return record->true;
        String include=Objects.toString(rules.get("include"),""),exclude=Objects.toString(rules.get("exclude"),"");
        Predicate<JSONObject> yes=compile(include),no=exclude.isEmpty()?record->false:compile(exclude);
        return record->yes.test(record) && !no.test(record);
    }
    public static Predicate<JSONObject> compile(String value) {
        String text=decode(value);
        if(text.length()>4096)throw new Invalid("Filter exceeds 4096 characters.");
        if(text.startsWith("expr:"))return new Parser(text).parse();
        if(text.isEmpty())return record->true;
        String[] parts=text.split("\\|",-1);
        Predicate<String> include=legacy(parts[0]),exclude=legacy(parts.length>1?parts[1]:"");
        return record->{
            JSONObject source=new JSONObject(record);source.remove("sourceRecordKey");
            String serialized=source.toJSONString().replace("\"", "");
            return (parts[0].isEmpty() || include.test(serialized)) && !exclude.test(serialized);
        };
    }
    private static Predicate<String> legacy(String part) {
        if(part.isEmpty())return text->false;
        List<List<Predicate<String>>> groups=new ArrayList<>();
        try {
            for(String alternative:part.split(";",-1)) {
                List<Predicate<String>> terms=new ArrayList<>();
                for(String term:alternative.split("\\+",-1)) {
                    Pattern pattern=Pattern.compile(term);
                    terms.add(text->pattern.matcher(text).find() || term.startsWith("description:") && text.contains(term.substring(12)));
                }
                groups.add(terms);
            }
        } catch(java.util.regex.PatternSyntaxException error) {throw new Invalid("Invalid legacy regular expression: "+error.getDescription());}
        return text->groups.stream().anyMatch(group->group.stream().allMatch(term->term.test(text)));
    }
    private static final Object MISSING=new Object();
    private static Object field(JSONObject record,String path) {
        String[] parts=path.split("\\.");
        Object value=record;
        if(!record.containsKey(parts[0]) && record.get("data") instanceof Map<?,?> data)value=data;
        for(String part:parts) {
            if(!(value instanceof Map<?,?> map) || !map.containsKey(part))return MISSING;
            value=map.get(part);
        }
        return value;
    }
    private static boolean equal(Object left,Object right) {
        if(left==MISSING)return false;
        if(left instanceof Number a && right instanceof Number b)return a.doubleValue()==b.doubleValue();
        return Objects.equals(left,right);
    }
    private static boolean compare(Object left,String operator,Object right) {
        if(left==MISSING)return false;
        if(operator.equals("=") || operator.equals("=="))return equal(left,right);
        if(operator.equals("!="))return !equal(left,right);
        if(left==null || right==null)return false;
        if(Set.of("CONTAINS","STARTS_WITH","ENDS_WITH").contains(operator)) {
            if(!(left instanceof String a) || !(right instanceof String b))return false;
            return operator.equals("CONTAINS")?a.contains(b):operator.equals("STARTS_WITH")?a.startsWith(b):a.endsWith(b);
        }
        int order;
        if(left instanceof Number a && right instanceof Number b)order=a.doubleValue()==b.doubleValue()?0:Double.compare(a.doubleValue(),b.doubleValue());
        else if(left instanceof String a && right instanceof String b)order=a.compareTo(b);
        else return false;
        return switch(operator) {case ">"->order>0;case ">="->order>=0;case "<"->order<0;case "<="->order<=0;default->false;};
    }
    private record Token(String text,Object value,int offset,boolean literal) {}
    private static final class Parser {
        final String source;final List<Token> tokens=new ArrayList<>();int index,depth;
        Parser(String source) {this.source=source;tokenize();}
        Invalid error(int offset,String message) {return new Invalid("Filter at character "+(offset+1)+": "+message);}
        void tokenize() {
            for(int i=5;i<source.length();) {
                char c=source.charAt(i);if(Character.isWhitespace(c)){i++;continue;}
                int start=i;
                if(c=='\'' || c=='"') {
                    char quote=c;StringBuilder value=new StringBuilder();boolean closed=false;i++;
                    while(i<source.length()) {
                        c=source.charAt(i++);
                        if(c==quote){closed=true;break;}
                        if(c=='\\') {
                            if(i>=source.length())throw error(i-1,"Incomplete escape.");
                            c=source.charAt(i++);
                            switch(c) {
                                case 'n'->value.append('\n');case 'r'->value.append('\r');case 't'->value.append('\t');
                                case '\\','\'','"'->value.append(c);
                                default->throw error(i-1,"Use \\n, \\r, \\t, or an escaped quote or backslash.");
                            }
                        } else value.append(c);
                    }
                    if(!closed)throw error(start,"Unclosed quoted value.");
                    tokens.add(new Token(source.substring(start,i),value.toString(),start,true));
                } else if("(),".indexOf(c)>=0) {tokens.add(new Token(""+c,null,i++,false));}
                else if("=!<>".indexOf(c)>=0) {
                    i++;if(i<source.length() && source.charAt(i)=='=')i++;
                    tokens.add(new Token(source.substring(start,i),null,start,false));
                } else {
                    while(i<source.length() && !Character.isWhitespace(source.charAt(i)) && "(),=!<>\"'".indexOf(source.charAt(i))<0)i++;
                    String word=source.substring(start,i);
                    tokens.add(new Token(word,null,start,false));
                }
                if(tokens.size()>512)throw error(start,"Too many terms (maximum 512 tokens).");
            }
            tokens.add(new Token("",null,source.length(),false));
        }
        Token peek(){return tokens.get(index);}
        boolean take(String text){if(!peek().literal && peek().text.equalsIgnoreCase(text)){index++;return true;}return false;}
        void require(String text){if(!take(text))throw error(peek().offset,"Expected '"+text+"'.");}
        Predicate<JSONObject> parse(){Predicate<JSONObject> result=or();if(!peek().text.isEmpty())throw error(peek().offset,"Unexpected token.");return result;}
        Predicate<JSONObject> or(){Predicate<JSONObject> result=and();while(take("OR")){result=result.or(and());}return result;}
        Predicate<JSONObject> and(){Predicate<JSONObject> result=unary();while(take("AND")){result=result.and(unary());}return result;}
        Predicate<JSONObject> unary(){
            if(++depth>32)throw error(peek().offset,"Expressions may nest up to 32 levels.");
            try {
                if(take("NOT"))return unary().negate();
                if(take("(")){Predicate<JSONObject> result=or();require(")");return result;}
                if(take("EXISTS")){require("(");String name=name();require(")");return record->field(record,name)!=MISSING;}
                String name=name();Token token=peek();String op=token.text.toUpperCase(Locale.ROOT);index++;
                if(op.equals("IN")) {
                    require("(");List<Object> values=new ArrayList<>();values.add(literal());
                    while(take(","))values.add(literal());require(")");
                    return record->values.stream().anyMatch(value->equal(field(record,name),value));
                }
                if(!Set.of("=","==","!=",">",">=","<","<=","CONTAINS","STARTS_WITH","ENDS_WITH").contains(op))
                    throw error(token.offset,"Expected a comparison, CONTAINS, STARTS_WITH, ENDS_WITH, or IN.");
                Object value=literal();return record->compare(field(record,name),op,value);
            } finally {depth--;}
        }
        String name(){Token token=peek();if(token.literal || !token.text.matches("[A-Za-z_][A-Za-z0-9_-]*(\\.[A-Za-z_][A-Za-z0-9_-]*)*"))throw error(token.offset,"Expected a field name.");index++;return token.text;}
        Object literal(){
            Token token=peek();if(token.literal){index++;return token.value;}
            String text=token.text;
            if(text.isEmpty() || Set.of(",", ")", "(", "AND", "OR", "NOT").contains(text.toUpperCase(Locale.ROOT)))throw error(token.offset,"Expected a value; quote text containing spaces or operators.");
            index++;
            if(text.equalsIgnoreCase("null"))return null;
            if(text.equalsIgnoreCase("true") || text.equalsIgnoreCase("false"))return Boolean.parseBoolean(text.toLowerCase(Locale.ROOT));
            if(text.matches("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")) {
                double number=Double.parseDouble(text);if(!Double.isFinite(number))throw error(token.offset,"Number must be finite.");return number;
            }
            if(!text.matches("[A-Za-z_][A-Za-z0-9_-]*"))throw error(token.offset,"Quote this text value.");
            return text;
        }
    }
}
