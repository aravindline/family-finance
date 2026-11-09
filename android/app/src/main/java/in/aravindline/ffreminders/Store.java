package in.aravindline.ffreminders;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;

/** The checklist, kept only on this phone (each person has their own list and ticks). */
final class Store {
    static final String URL = "https://aravindline.github.io/family-finance/";
    private static final String PREFS = "reminders", KEY = "items";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** First run: the two agreed starters. Renewals and card due dates are added by each person. */
    static List<Item> starters() {
        List<Item> l = new ArrayList<>();
        l.add(Item.of("daily", "Add today's entries", Item.DAILY, 20, 45));
        Item m = Item.of("monthend", "Month-end update", Item.MONTHLY, 19, 0); m.from = 1; m.to = 5; l.add(m);
        return l;
    }

    static List<Item> load(Context c) {
        String s = prefs(c).getString(KEY, null);
        if (s == null) { List<Item> l = starters(); save(c, l); return l; }
        List<Item> l = new ArrayList<>();
        try { JSONArray a = new JSONArray(s); for (int i = 0; i < a.length(); i++) l.add(Item.fromJson(a.getJSONObject(i))); }
        catch (JSONException e) { /* unreadable: start again with the starters */ return starters(); }
        return l;
    }

    static void save(Context c, List<Item> l) {
        JSONArray a = new JSONArray();
        try { for (Item i : l) a.put(i.toJson()); } catch (JSONException e) { return; }
        prefs(c).edit().putString(KEY, a.toString()).apply();
    }

    static Item find(List<Item> l, String id) { for (Item i : l) if (i.id.equals(id)) return i; return null; }
    static String newId() { return UUID.randomUUID().toString().substring(0, 8); }
}
