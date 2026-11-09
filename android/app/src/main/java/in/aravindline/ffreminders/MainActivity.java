package in.aravindline.ffreminders;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.NumberPicker;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;
import java.time.LocalDate;
import java.util.List;

/** The checklist: tick what's done, tap a reminder to change it, add your own. Everything stays on this phone. */
public class MainActivity extends Activity {
    private static final int BRAND = 0xFF166548, BG = 0xFFF3F5F4, CARD = 0xFFFFFFFF, INK = 0xFF121A16, MUTED = 0xFF5D6A63, LINE = 0xFFE2E7E4, WARN = 0xFF8A5A00;
    private static final String[] MONTHS = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
    private LinearLayout list, banner;
    private List<Item> items;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        Notify.ensureChannel(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 7);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(16), dp(28), dp(16), dp(24));
        col.addView(text("Finance Reminders", 26, INK, true));
        col.addView(text("Your own checklist. Ticks are only on this phone.", 15, MUTED, false));
        space(col, 16);
        Button open = button("Open Family Finance", BRAND, Color.WHITE);
        open.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Store.URL))));
        col.addView(open);
        space(col, 12);
        banner = new LinearLayout(this); banner.setOrientation(LinearLayout.VERTICAL); col.addView(banner);
        list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL);
        list.setBackground(round(CARD, LINE)); list.setPadding(dp(4), dp(4), dp(4), dp(4));
        col.addView(list);
        space(col, 12);
        Button add = button("+  Add reminder", CARD, INK);
        add.setOnClickListener(v -> edit(null));
        col.addView(add);
        space(col, 8);
        Button test = button("Test a notification", CARD, INK);
        test.setOnClickListener(v -> { Item t = Item.of("test", "Test reminder", Item.DAILY, 0, 0); Notify.show(this, t);
            if (!getSystemService(android.app.NotificationManager.class).areNotificationsEnabled()) Toast.makeText(this, "Allow notifications first", Toast.LENGTH_SHORT).show(); });
        col.addView(test);
        space(col, 16);
        col.addView(text("Tap a reminder to change its name, time or repeat, switch it off or delete it. A tick closes it until it's due again. \"Done\" on a notification ticks it too.", 13, MUTED, false));

        ScrollView sv = new ScrollView(this); sv.setBackgroundColor(BG); sv.addView(col);
        setContentView(sv);
    }

    @Override protected void onResume() { super.onResume(); items = Store.load(this); Notify.run(this); items = Store.load(this); draw(); }
    @Override public void onRequestPermissionsResult(int code, String[] p, int[] r) { draw(); }

    private void draw() {
        banner.removeAllViews();
        if (!getSystemService(android.app.NotificationManager.class).areNotificationsEnabled()) {
            TextView w = text("Notifications are off for this app, so reminders can't show.", 15, WARN, false);
            banner.addView(w);
            Button allow = button("Allow notifications", CARD, INK);
            allow.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
            banner.addView(allow); space(banner, 12);
        }
        list.removeAllViews();
        LocalDate today = LocalDate.now();
        if (items.isEmpty()) { TextView e = text("No reminders. Tap Add reminder.", 15, MUTED, false); e.setPadding(dp(12), dp(14), dp(12), dp(14)); list.addView(e); }
        for (int k = 0; k < items.size(); k++) {
            Item i = items.get(k);
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL); row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(4), dp(10), dp(12), dp(10)); row.setMinimumHeight(dp(64));
            CheckBox cb = new CheckBox(this);
            cb.setChecked(i.tickedNow(today)); cb.setEnabled(i.on);
            cb.setContentDescription("Done: " + i.name);
            cb.setOnCheckedChangeListener((v, on) -> { i.tick(LocalDate.now(), on); if (on) Notify.cancel(this, i); Store.save(this, items); Notify.schedule(this, items); draw(); });
            row.addView(cb, new LinearLayout.LayoutParams(dp(48), dp(48)));
            LinearLayout txt = new LinearLayout(this); txt.setOrientation(LinearLayout.VERTICAL);
            TextView name = text(i.name, 17, i.on ? INK : MUTED, true);
            if (cb.isChecked()) name.setPaintFlags(name.getPaintFlags() | android.graphics.Paint.STRIKE_THRU_TEXT_FLAG);
            txt.addView(name);
            txt.addView(text(i.ruleText(), 13, MUTED, false));
            String st = i.statusText(today);
            txt.addView(text(st, 13, st.startsWith("Due") ? BRAND : MUTED, st.startsWith("Due")));
            row.addView(txt, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            row.addView(text("›", 22, MUTED, false));
            row.setOnClickListener(v -> edit(i));
            if (k > 0) { View line = new View(this); line.setBackgroundColor(LINE); list.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)); }
            list.addView(row);
        }
    }

    /** Add (item == null) or change a reminder. */
    private void edit(Item existing) {
        final Item i = existing != null ? existing : Item.of(Store.newId(), "", Item.YEARLY, 9, 0);
        if (existing == null) { i.before = 7; LocalDate t = LocalDate.now(); i.month = t.getMonthValue(); i.day = t.getDayOfMonth(); i.from = t.getDayOfMonth(); i.to = t.getDayOfMonth(); }
        final int[] time = { i.hour, i.minute };
        LinearLayout f = new LinearLayout(this); f.setOrientation(LinearLayout.VERTICAL); f.setPadding(dp(20), dp(8), dp(20), dp(8));

        f.addView(label("Name"));
        EditText name = new EditText(this); name.setText(i.name); name.setHint("e.g. Health insurance renewal");
        name.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); name.setSingleLine(true);
        f.addView(name);

        f.addView(label("Repeat"));
        RadioGroup rg = new RadioGroup(this);
        RadioButton rD = radio("Every day"), rM = radio("Every month"), rY = radio("Every year");
        rg.addView(rD); rg.addView(rM); rg.addView(rY);
        f.addView(rg);

        Button tb = button("", CARD, INK);
        Runnable showTime = () -> { Item tmp = new Item(); tmp.hour = time[0]; tmp.minute = time[1]; tb.setText("Time: " + tmp.timeText()); };
        showTime.run();
        tb.setOnClickListener(v -> new TimePickerDialog(this, (tp, h, m) -> { time[0] = h; time[1] = m; showTime.run(); }, time[0], time[1], false).show());
        space(f, 6); f.addView(tb);

        LinearLayout monthly = new LinearLayout(this); monthly.setOrientation(LinearLayout.VERTICAL);
        monthly.addView(label("Days of the month (same day twice for one day, e.g. card due on 15 to 15)"));
        LinearLayout mr = new LinearLayout(this); mr.setGravity(Gravity.CENTER_VERTICAL);
        NumberPicker pFrom = picker(1, 31, i.from, null), pTo = picker(1, 31, i.to, null);
        mr.addView(text("From day ", 15, INK, false)); mr.addView(pFrom); mr.addView(text("  to day ", 15, INK, false)); mr.addView(pTo);
        monthly.addView(mr);
        f.addView(monthly);

        LinearLayout yearly = new LinearLayout(this); yearly.setOrientation(LinearLayout.VERTICAL);
        yearly.addView(label("Date every year"));
        LinearLayout yr = new LinearLayout(this); yr.setGravity(Gravity.CENTER_VERTICAL);
        NumberPicker pDay = picker(1, 31, i.day, null), pMon = picker(1, 12, i.month, MONTHS);
        yr.addView(pDay); yr.addView(text("  ", 15, INK, false)); yr.addView(pMon);
        yearly.addView(yr);
        f.addView(yearly);

        LinearLayout lead = new LinearLayout(this); lead.setOrientation(LinearLayout.VERTICAL);
        lead.addView(label("Start reminding how many days before? (0 = only on the day)"));
        NumberPicker pBefore = picker(0, 60, i.before, null);
        lead.addView(pBefore);
        f.addView(lead);

        Switch on = new Switch(this); on.setText("Reminder on"); on.setChecked(i.on); on.setTextSize(16); on.setPadding(0, dp(12), 0, dp(4));
        f.addView(on);

        Runnable vis = () -> { int id = rg.getCheckedRadioButtonId(); monthly.setVisibility(id == rM.getId() ? View.VISIBLE : View.GONE);
            yearly.setVisibility(id == rY.getId() ? View.VISIBLE : View.GONE); lead.setVisibility(id == rD.getId() ? View.GONE : View.VISIBLE); };
        rg.check(Item.MONTHLY.equals(i.repeat) ? rM.getId() : Item.YEARLY.equals(i.repeat) ? rY.getId() : rD.getId());
        rg.setOnCheckedChangeListener((g, id) -> vis.run());
        vis.run();

        ScrollView sv = new ScrollView(this); sv.addView(f);
        AlertDialog.Builder db = new AlertDialog.Builder(this).setTitle(existing == null ? "Add reminder" : "Change reminder").setView(sv)
                .setPositiveButton("Save", null).setNegativeButton("Cancel", null);
        if (existing != null) db.setNeutralButton("Delete", (d, w) -> new AlertDialog.Builder(this).setMessage("Delete \"" + i.name + "\"?")
                .setPositiveButton("Delete", (d2, w2) -> { Notify.cancel(this, i); items.remove(i); Store.save(this, items); Notify.schedule(this, items); draw(); })
                .setNegativeButton("Keep", null).show());
        AlertDialog dlg = db.create();
        dlg.setOnShowListener(x -> dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String n = name.getText().toString().trim();
            if (n.isEmpty()) { name.setError("Give it a name"); return; }
            if (n.matches(".*\\d{5,}.*")) { name.setError("No long numbers. Card or account: last 4 digits only."); return; }
            int id = rg.getCheckedRadioButtonId();
            String rep = id == rM.getId() ? Item.MONTHLY : id == rY.getId() ? Item.YEARLY : Item.DAILY;
            if (Item.MONTHLY.equals(rep) && pFrom.getValue() > pTo.getValue()) { Toast.makeText(this, "\"From day\" must be on or before \"to day\"", Toast.LENGTH_LONG).show(); return; }
            boolean ruleChanged = !rep.equals(i.repeat) || i.from != pFrom.getValue() || i.to != pTo.getValue() || i.month != pMon.getValue() || i.day != pDay.getValue() || i.before != pBefore.getValue();
            boolean timeChanged = i.hour != time[0] || i.minute != time[1];
            i.name = n; i.repeat = rep; i.hour = time[0]; i.minute = time[1];
            i.from = pFrom.getValue(); i.to = pTo.getValue(); i.month = pMon.getValue(); i.day = pDay.getValue(); i.before = pBefore.getValue();
            i.on = on.isChecked();
            if (ruleChanged) i.done = "";
            if (ruleChanged || timeChanged) i.notified = ""; // a new later time today should still show today
            if (existing == null) items.add(i);
            Store.save(this, items); Notify.run(this); items = Store.load(this); draw(); dlg.dismiss();
        }));
        dlg.show();
    }

    // ---------------------------------------------------------------- small helpers
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this); t.setText(s); t.setTextSize(sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD); t.setLineSpacing(0, 1.15f); return t;
    }
    private TextView label(String s) { TextView t = text(s, 13, MUTED, true); t.setPadding(0, dp(14), 0, dp(4)); return t; }
    private RadioButton radio(String s) { RadioButton r = new RadioButton(this); r.setText(s); r.setTextSize(16); r.setId(View.generateViewId()); return r; }
    private NumberPicker picker(int min, int max, int val, String[] names) {
        NumberPicker p = new NumberPicker(this); p.setMinValue(min); p.setMaxValue(max);
        if (names != null) p.setDisplayedValues(names);
        p.setValue(Math.min(Math.max(val, min), max)); p.setWrapSelectorWheel(false); return p;
    }
    private GradientDrawable round(int bg, int stroke) { GradientDrawable d = new GradientDrawable(); d.setColor(bg); d.setCornerRadius(dp(14)); d.setStroke(dp(1), stroke); return d; }
    private Button button(String s, int bg, int fg) {
        Button bt = new Button(this); bt.setText(s); bt.setTextSize(16); bt.setTextColor(fg); bt.setAllCaps(false);
        bt.setMinHeight(dp(52)); bt.setPadding(dp(12), dp(8), dp(12), dp(8));
        bt.setBackground(round(bg, bg == CARD ? LINE : bg)); bt.setStateListAnimator(null); return bt;
    }
    private void space(LinearLayout l, int h) { View v = new View(this); l.addView(v, new LinearLayout.LayoutParams(1, dp(h))); }
}
