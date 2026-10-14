package com.openbexi.timeline.data_browser;

import org.json.simple.JSONObject;
import java.nio.file.Path;
import java.util.*;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/** List-valued source filters select filenames; string filters select records. */
final class SourceFileFilters {
    private SourceFileFilters() {}
    static Predicate<Path> compile(JSONObject source,Path root) {
        if(!(source.get("filter") instanceof Map<?,?> filter))return path->true;
        List<Pattern> include=patterns(filter.get("include")),exclude=patterns(filter.get("exclude"));
        return path->{
            String name=path.getFileName().toString(),relative=root.relativize(path).toString().replace('\\','/');
            return (include.isEmpty()||include.stream().anyMatch(pattern->matches(pattern,name,relative)))&&
                    exclude.stream().noneMatch(pattern->matches(pattern,name,relative));
        };
    }
    private static boolean matches(Pattern pattern,String name,String relative) {return pattern.matcher(name).matches()||pattern.matcher(relative).matches();}
    private static List<Pattern> patterns(Object value) {
        if(!(value instanceof List<?> patterns))return List.of();
        return patterns.stream().map(Object::toString).map(SourceFileFilters::glob).toList();
    }
    private static Pattern glob(String text) {
        StringBuilder result=new StringBuilder();
        for(int i=0;i<text.length();i++) {
            char c=text.charAt(i);
            if(c=='*') {if(i==0||text.charAt(i-1)!='*')result.append(".*");}
            else if(c=='?')result.append('.');
            else if(c=='[') {
                int end=text.indexOf(']',i+1);
                if(end<0)result.append("\\[");
                else if(end==i+1||text.substring(i+1,end).equals("!")) {result.append(Pattern.quote(text.substring(i,end+1)));i=end;}
                else {String range=text.substring(i+1,end);result.append('[');
                    if(range.startsWith("!")){result.append('^');range=range.substring(1);}
                    else if(range.startsWith("^"))result.append('\\');
                    result.append(range.replace("\\","\\\\").replace("[","\\[").replace("&","\\&")).append(']');i=end;}
            } else result.append(Pattern.quote(Character.toString(c)));
        }
        try {return Pattern.compile(result.toString());}
        catch(java.util.regex.PatternSyntaxException ignored) {return Pattern.compile("(?!)");}
    }
}
