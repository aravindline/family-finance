package in.aravindline.ffreminders;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The booked time has come: show what is due and book the next one. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) { Notify.run(c); }
}
