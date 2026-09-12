// Translate display labels at the UI boundary; simulation IDs and states stay intact.
const labels={
 '虹桥南 · 开始步行':'South Bridge · Start walking','城门 · 穿城':'City Gate · Walk through','院门 · 寻常人家':'Courtyard · Enter',
 '香铺':'Incense Shop','食铺':'Food Shop','茶肆':'Teahouse','粮铺':'Grain Shop','客舍':'Guesthouse','杂货':'General Store','布庄':'Cloth Shop','药铺':'Apothecary','鱼行':'Fish Market','酒楼':'Tavern',
 ' · 入内':' · Enter','营业厅':' · Main room','起居堂屋':'Living hall','灶间与卧房':'Kitchen and bedroom','后厨与仓储':'Kitchen and storeroom','楼上卧房与书案':'Upstairs bedroom and study',
 '入户门':'front door','楼台门':'balcony door','推开':'Opened ','合上':'Closed ',
 '北岸东货埠':'Northeast Quay','北岸西货埠':'Northwest Quay','南岸东货埠':'Southeast Quay','南岸西货埠':'Southwest Quay',
 '北岸东市集':'Northeast Market','北岸西市集':'Northwest Market','南岸东市集':'Southeast Market','南岸西市集':'Southwest Market',
 'Cargo_barge':'Cargo Barge','Trading_sailboat':'Trading Sailboat','Fishing_rowboat':'Fishing Boat','Ferry':'Ferry','Covered_passenger_boat':'Covered Passenger Boat','Courier_skiff':'Courier Skiff',
 '航行':'Under way','靠泊装卸':'Loading / unloading','离泊':'Departing','候航避让':'Waiting for traffic','减速靠泊':'Approaching berth',
 '运送':'Delivering','装卸停靠':'Loading stop','等候通行':'Waiting for passage','礼让行人':'Yielding to pedestrians',
 '取货':'Collecting cargo','往来':'Travelling','停留':'Stopped','搬货':'Carrying cargo','返回货埠':'Returning to quay','步行':'Walking',
 '卸下 ':' unloaded ','回程装货 ':' loaded for return: ','份货物':'units of cargo','靠泊':' moored','搬运抵达仓棚':' · Cargo delivered to warehouse',
 '在仓棚装货 ':' picked up cargo: ','在市街卸货 ':' delivered to market: ','车队':'Convoy ','份':'units',
 '虹桥—主街生活路线':'Hongqiao–Market Street Walk','虹桥—茶肆—城门市街':'Hongqiao–Teahouse–City Gate',
 '货运车队 · 虹桥—主街环线':'Freight convoy · Bridge–Market loop','北坊住户往来':'North district residents','南坊住户往来':'South district residents','城门巡更':'Gate patrol',
 '装卸路线':' loading route','货埠':'Quay ','水路':'waterway'
};
const pattern=new RegExp(Object.keys(labels).sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
export const english=value=>String(value).replace(pattern,word=>labels[word]);
