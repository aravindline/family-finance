package in.aravindline.ffreminders;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.time.LocalDate;
import java.util.List;

/** "Done" on a notification: ticks that reminder on the checklist and clears the notification. */
public class DoneReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent in) {
        List<Item> l = Store.load(c);
        Item i = Store.find(l, String.valueOf(in.getStringExtra("id")));
        if (i == null) return;
        i.tick(LocalDate.now(), true);
        Store.save(c, l);
        Notify.cancel(c, i);
        Notify.schedule(c, l);
    }
}
