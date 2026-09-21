package com.openbexi.timeline.api;

import org.json.*;
import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.nio.file.*;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

/** The Java API accepts and rejects the same model configurations as the browser. */
class TimelineModelsTest {
    private final Path root = Path.of("").toAbsolutePath();

    private JSONObject model(String id) throws IOException {
        return new JSONObject(Files.readString(root.resolve("models/demos/" + id + ".json")));
    }

    private JSONObject band(JSONObject model, int index) { return model.getJSONArray("bands").getJSONObject(index); }

    private ApiException rejects(String id, Consumer<JSONObject> mutate, String path) throws IOException {
        JSONObject model = model(id);
        mutate.accept(model);
        TimelineModels validator = new TimelineModels(root);
        ApiException error = assertThrows(ApiException.class, () -> validator.validate(model));
        assertEquals(422, error.status);
        assertTrue(error.getMessage().contains(path), error.getMessage());
        return error;
    }

    @Test
    void everyCatalogModelIsAcceptedAndUnmodified() throws IOException {
        TimelineModels validator = new TimelineModels(root);
        JSONObject catalog = new JSONObject(Files.readString(root.resolve("demos/catalog.json")));
        assertEquals(7, catalog.getJSONArray("demos").length());
        for (Object item : catalog.getJSONArray("demos")) {
            JSONObject model = new JSONObject(Files.readString(root.resolve(((JSONObject) item).getString("model"))));
            JSONObject before = new JSONObject(model.toString());
            assertSame(model, validator.validate(model));
            assertTrue(before.similar(model), "Validation must not normalize or mutate the model");
        }
    }

    @Test
    void structuralErrorsIdentifyMissingAndUnknownProperties() throws IOException {
        rejects("default-dataset", model -> model.getJSONArray("params").getJSONObject(0).remove("width"), "$.params[0].width");
        rejects("default-dataset", model -> band(model, 0).put("typo.option", true), "$.bands[0][\"typo.option\"]");
        rejects("default-dataset", model -> band(model, 0).getJSONObject("range").put("form", "2026"), "$.bands[0].range.form");
        rejects("default-dataset", model -> band(model, 0).put("ticks", new JSONObject().put("unit", "MINUTE").put("step", 0)), "$.bands[0].ticks.step");
        rejects("default-dataset", model -> band(model, 0).getJSONObject("focus").put("magnification", 0), "$.bands[0].focus.magnification");
        rejects("dinausaurs", model -> model.getJSONObject("dataSource").getJSONObject("time").put("direction", 0), "$.dataSource.time.direction");
    }

    @Test
    void finiteDatesAndAxisOrderingMatchBrowserRules() throws IOException {
        rejects("default-dataset", model -> model.getJSONArray("params").getJSONObject(0).put("date", "invalid"), "$.params[0].date");
        rejects("default-dataset", model -> model.getJSONArray("params").getJSONObject(0).put("date", 1e300), "$.params[0].date");
        rejects("default-dataset", model -> band(model, 0).getJSONObject("range").put("to", "2026-09-12T08:00:00Z"), "$.bands[0].range.to");
        rejects("default-dataset", model -> band(model, 0).getJSONObject("context").put("from", "nonsense"), "$.bands[0].context.from");
        rejects("dinausaurs", model -> band(model, 0).put("range", new JSONObject().put("from", 40).put("to", 240)), "$.bands[0].range.to");
        rejects("dinausaurs", model -> band(model, 0).getJSONObject("range").put("from", "?240"), "$.bands[0].range.from");
        rejects("dinausaurs", model -> model.getJSONArray("params").getJSONObject(0).put("date", 1e300), "$.params[0].date");
        rejects("religions", model -> model.getJSONArray("params").getJSONObject(0).put("date", "999999"), "$.params[0].date");
        JSONObject historical = model("religions");
        historical.getJSONArray("params").getJSONObject(0).put("date", "44 BCE");
        assertSame(historical, new TimelineModels(root).validate(historical));
        rejects("religions", model -> band(model, 0).getJSONObject("range").put("to", "-002000-01-01T00:00:00Z"), "$.bands[0].range.to");
    }

    @Test
    void nestedFocusArraysAndTickCompatibilityAreChecked() throws IOException {
        rejects("jfk", model -> band(model, 1).getJSONArray("focus").getJSONObject(1).put("to", "invalid"), "$.bands[1].focus[1].to");
        rejects("jfk", model -> band(model, 1).getJSONArray("focus").getJSONObject(1).getJSONObject("ticks").put("unit", "NUMERIC"), "$.bands[1].focus[1].ticks.unit");
        rejects("dinausaurs", model -> band(model, 0).getJSONObject("ticks").put("unit", "YEAR"), "$.bands[0].ticks.unit");
        rejects("dinausaurs", model -> band(model, 0).put("tickMinutes", 10), "$.bands[0].tickMinutes");
        rejects("default-dataset", model -> band(model, 0).put("ticks", new JSONObject().put("unit", "MINUTE").put("step", 10)), "$.bands[0].tickMinutes");
        rejects("religions", model -> band(model, 0).getJSONObject("ticks").put("step", 1.5), "$.bands[0].ticks.step");
        rejects("religions", model -> band(model, 0).getJSONObject("focus").getJSONObject("ticks").put("step", 1.5), "$.bands[0].focus.ticks.step");
    }

    @Test
    void overviewReferencesAndLayoutRequirementsMatchBrowser() throws IOException {
        rejects("default-dataset", model -> band(model, 1).put("sourceBands", new JSONArray().put("missing")), "$.bands[1].sourceBands[0]");
        rejects("default-dataset", model -> band(model, 1).put("sourceBands", new JSONArray().put(band(model, 1).getString("name"))), "$.bands[1].sourceBands[0]");
        rejects("default-dataset", model -> band(model, 0).put("sourceBands", new JSONArray().put(band(model, 0).getString("name"))), "$.bands[0].sourceBands");
        rejects("default-dataset", model -> {
            band(model, 0).put("groupBy", "data.satellite");
            band(model, 1).put("sourceBands", new JSONArray().put(band(model, 0).getString("name")));
        }, "$.bands[1].sourceBands[0]");
        rejects("default-dataset", model -> band(model, 1).put("name", band(model, 0).getString("name")), "$.bands[1].name");
        rejects("default-dataset", model -> band(model, 0).put("height", "101%"), "$.bands[0].height");
        rejects("default-dataset", model -> model.getJSONArray("bands").remove(1), "$.params[0].dockOverview");
        rejects("default-dataset", model -> model.getJSONArray("bands").remove(0), "$.bands must include a normal band");
    }

    @Test
    void secondaryScalesAndZonesValidateDatesAndAxisTypes() throws IOException {
        rejects("dinausaurs", model -> band(model, 0).put("secondaryScale", new JSONObject().put("format", "elapsedYears").put("origin", "1900").put("step", 10)), "$.bands[0].secondaryScale");
        rejects("monet", model -> band(model, 0).getJSONObject("secondaryScale").put("origin", "invalid"), "$.bands[0].secondaryScale.origin");
        rejects("jfk", model -> model.getJSONObject("dataSource").getJSONArray("zones").getJSONObject(0).put("end", "invalid"), "$.dataSource.zones[0].end");
        rejects("jfk", model -> model.getJSONObject("dataSource").getJSONArray("zones").getJSONObject(0).put("end", "1963-11-22T18:00:00Z"), "$.dataSource.zones[0].end");
    }
}
