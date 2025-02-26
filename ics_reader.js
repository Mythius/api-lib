const TIMESTRINGS = [
  "DTSTART",
  "DTEND",
  "DTSTAMP",
  "CREATED",
  "LAST-MODIFIED",
  "RECURRENCE-ID",
];
async function CalendarJSON(icslink = "") {
  let data;
  let result = [];
  let curr_obj = null;
  let tzid = "";
  try {
    let req = await fetch(icslink);
    let text = await req.text();
    data = text.split("\n");
  } catch (e) {
    console.log(e);
    return;
  }

  let buffer_key = "";
  let buffer = "";
  for (let line of data) {
    if (line.includes("BEGIN:VEVENT")) {
      curr_obj = {};
      continue;
    }
    if (line.includes("END:VEVENT")) {
      result.push(curr_obj);
      curr_obj = null;
      continue;
    }
    if (curr_obj != null) {
      if (line.includes(":")) {
        if (buffer_key) {
          if (TIMESTRINGS.includes(buffer_key)) {
            curr_obj[buffer_key] = toDate(buffer.trim());
          } else {
            curr_obj[buffer_key] = buffer.trim();
          }
        }
        let arr = line.split(":");
        buffer_key = arr[0];
        buffer = arr[1];
        if (buffer_key.includes(";")) {
          let parts = buffer_key.split(";");
          buffer_key = parts[0];
          if (parts[1].includes("TZID=")) {
            let time_zone = parts[1].split("TZID=")[1];
            buffer = convertISOWithTimeZone(arr[1], time_zone);
          }
          // console.log('To '+buffer_key);
          // console.log('Data',arr[1]);
        }
      } else {
        buffer += line;
      }
    } else {
      console.log(line);
      if (line.includes("TZID")) {
        tzid = line.split(":")[1];
      }
    }
  }
  return result;
}

function toDate(dateString) {
  //   console.log(dateString);
  if (dateString.includes("T")) {
    let = [_, year, month, day, hour, min, sec] = dateString.match(
      /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/
    );
    let date = new Date(year, month - 1, day, hour, min, sec);
    // console.log(`Converted ${dateString} to ` + date);
    return date;
  } else {
    // console.log("Parsing", dateString);
    let = [_, year, month, day] = dateString.match(/(\d{4})(\d{2})(\d{2})/);
    let date = new Date(year, month - 1, day);
    return date;
  }
}

async function test() {
  let obj = await CalendarJSON(
  );
  let d = new Date();
  d.setDate(d.getDate() + 2);
  // console.log(obj.slice(0,5))
  console.log(getEventsToday(obj, d));
  //   console.log(
  //     getEventsToday(obj).map(
  //       (e) =>
  //         `${e.SUMMARY} @ ${e.DTSTART?.toLocaleTimeString("en-US", {
  //           hour: "2-digit",
  //           minute: "2-digit",
  //           hour12: true,
  //         })}`
  //     )
  //   );
}

function convertISOWithTimeZone(isoString, timeZone) {
  // Parse the original UTC date string
  //   console.log('Converting time with zone',isoString,timeZone);
  const date = new Date(isoString.replace("Z", ""));

  // Get the actual UTC offset in hours and minutes
  const offsetMinutes =
    date.getTimezoneOffset() -
    new Date(date.toLocaleString("en-US", { timeZone })).getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  const sign = offsetMinutes > 0 ? "-" : "+";

  // Format the offset like "+07:00"
  const formattedOffset = `${sign}${String(offsetHours).padStart(
    2,
    "0"
  )}:${String(offsetMins).padStart(2, "0")}`;

  // Replace 'Z' with the correct offset
  let result = isoString.replace("Z", formattedOffset);
  //   console.log(result);
  return result;
}

function getEventsToday(data, day = new Date()) {
  return data.filter((e) => {
    if (!e.DTSTART) {
      console.log(e);
      return false;
    }
    return (
      e.DTSTART.getDate() === day.getDate() &&
      e.DTSTART.getMonth() === day.getMonth() &&
      e.DTSTART.getFullYear() === day.getFullYear()
    );
  });
}
function getEventsThisWeek(data, day = new Date()) {
  day.setDate(day.getDate() - day.getDay());
  return data.filter((e) => {
    if (!e.DTSTART) return false;
    let ot = new Date(e.DTSTART);
    ot.setDate(ot.getDate() - ot.getDay());
    return (
      ot.getDate() === day.getDate() &&
      ot.getMonth() === day.getMonth() &&
      ot.getFullYear() === day.getFullYear()
    );
  });
}
function getEventsThisMonth(data, day = new Date()) {
  return data.filter((e) => {
    if (!e.DTSTART) return false;
    return (
      e.DTSTART.getMonth() === day.getMonth() &&
      e.DTSTART.getFullYear() === day.getFullYear()
    );
  });
}
function getEventsThisYear(data, day = new Date()) {
  return data.filter((e) => {
    if (!e.DTSTART) return false;
    return e.DTSTART.getFullYear() === day.getFullYear();
  });
}

exports.CalendarJSON = CalendarJSON;
exports.getEventsThisMonth = getEventsThisMonth;
exports.getEventsToday = getEventsToday;
exports.getEventsThisWeek = getEventsThisWeek;
exports.getEventsThisYear = getEventsThisYear;
test();
