// Ready-made topics for a blank prompt. Things can be drawn or named. Situations are moments for a phrase.
(function(root){
  const things=[
    'a red umbrella','a clear umbrella','a train platform','the last train','a paper ticket','a suitcase','a window seat','a bicycle bell','a bicycle lock','a flat tire',
    'a mailbox','a spare key','a doorbell','an intercom','a wet coat','fogged glasses','a pocket warmer','a lost glove','mismatched socks','a mended sleeve',
    'a teacup','a cracked cup','a boiling kettle','burnt toast','a lunchbox','chopsticks','a convenience-store onigiri','a hot canned coffee','a vending machine','a shopping basket',
    'a library card','an overdue book','a coffee stain','a pencil','an eraser','a sketchbook','a classroom desk','a school bag','a chalkboard','a rain puddle',
    'a stone bridge','a wooden stair','a shrine gate','a temple bell','a paper crane','a festival stall','fireworks','a summer cicada','a winter coat','a houseplant',
    'a goldfish','a neighbor\'s cat','a bird feeder','a porch light','a drying futon','a laundry pole','a balcony','a shared fridge','a kitchen timer','a honey jar',
    'a lighthouse','a fishing boat','a river stone','a campfire','a flashlight','a compass','a paper map','a harbor','a yellow platform line','a night bus'
  ];
  const situations=[
    'asking for directions','missing the last train','returning a borrowed book','splitting a bill','ordering for someone else','apologizing for being late','introducing a friend','declining an invitation','asking to sit down','borrowing a pen',
    'losing a ticket','waiting in the rain','sharing an umbrella','rescheduling a meeting','buying a ticket','reserving a table','thanking a host','leaving a party early','offering a seat','asking for the wifi password',
    'reporting a lost item','checking into a hotel','asking where to put your shoes','asking someone to repeat themselves','saying you do not understand','asking for a recommendation','comparing two prices','returning a purchase','holding a door','asking if a seat is free',
    'missing your stop','asking which platform','confirming a name spelling','asking for the check','inviting someone for tea','saying you will be five minutes late','asking to open a window','warning someone about a wet floor','asking for a quieter room','joining a group photo'
  ];
  const api={things,situations};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DiscussionTopics=api;
})(typeof window==='undefined'?globalThis:window);
